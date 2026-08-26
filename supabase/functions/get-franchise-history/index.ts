import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  internalErrorResponse,
  authenticateUserOrServiceRole,
} from '../_shared/utils.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { buildCacheKey, cachedTmdbFetch } from '../_shared/tmdb-cache.ts'
import { tmdbGetJson } from '../_shared/tmdb.ts'
import { fetchMDBListRatings } from '../_shared/scoring.ts'
import {
  historyForMovie,
  releasedParts,
  MAX_PRIOR_FILMS,
  type CollectionPart,
  type CollectionRecord,
  type FranchiseFilm,
  type FranchiseHistory,
} from '../_shared/franchise-history.ts'

const log = createLogger('get-franchise-history')

/**
 * Batched on purpose: the draft grid, the bid picker and a trade card all
 * show many movies at once, and one request per card would be a request
 * storm on every scroll. The cap keeps a single call bounded.
 */
const MAX_IDS_PER_REQUEST = 40

/** Movies resolved at once. TMDb allows ~50 req/s; this is nowhere near it. */
const CONCURRENCY = 4

/**
 * Only the most recent prior films get a score lookup. A 30-part series
 * would otherwise cost 30 MDBList calls the first time anyone looks at it,
 * for films the history never shows (see MAX_PRIOR_FILMS).
 */
const SCORED_FILMS_PER_COLLECTION = MAX_PRIOR_FILMS + 4

/**
 * A week for both layers. Which collection a movie belongs to never changes,
 * and a released film's Tomatometer barely moves once it has settled -- the
 * cost of being a week stale is a point or two on an old film.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60

interface GetFranchiseHistoryRequest {
  tmdb_ids: number[]
}

interface GetFranchiseHistoryResponse {
  /** Keyed by tmdb_id. Null: not in a collection, or the first film of one. */
  histories: Record<string, FranchiseHistory | null>
}

/** The subset of `/3/movie/{id}` this function needs, cached per movie. */
interface MovieCollectionRef {
  tmdb_id: number
  release_date: string | null
  collection_id: number | null
  collection_name: string | null
}

interface TMDbMovie {
  id: number
  release_date: string | null
  belongs_to_collection: { id: number; name: string } | null
}

interface TMDbCollection {
  id: number
  name: string
  parts: CollectionPart[]
}

function posterUrl(path: string | null): string | null {
  return path ? `https://image.tmdb.org/t/p/w185${path}` : null
}

async function fetchMovieCollectionRef(tmdbId: number, tmdbToken: string): Promise<MovieCollectionRef> {
  const movie = await tmdbGetJson<TMDbMovie>(
    `https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`,
    tmdbToken
  )
  return {
    tmdb_id: movie.id,
    release_date: movie.release_date || null,
    collection_id: movie.belongs_to_collection?.id ?? null,
    collection_name: movie.belongs_to_collection?.name ?? null,
  }
}

/**
 * The Tomatometer for one released film, or null when MDBList has none. A
 * failed lookup is also null: the history still renders with a "not rated"
 * pill, and the collection record refreshes in a week.
 */
async function fetchTomatometer(tmdbId: number, mdblistApiKey: string): Promise<number | null> {
  const { ratings, error } = await fetchMDBListRatings(tmdbId, mdblistApiKey)
  if (error) {
    log.warn('Tomatometer lookup failed for franchise film', { tmdb_id: tmdbId, error })
  }
  return ratings.find((r) => r.source === 'rotten_tomatoes')?.score ?? null
}

async function fetchCollectionRecord(
  collectionId: number,
  tmdbToken: string,
  mdblistApiKey: string
): Promise<CollectionRecord> {
  const collection = await tmdbGetJson<TMDbCollection>(
    `https://api.themoviedb.org/3/collection/${collectionId}?language=en-US`,
    tmdbToken
  )
  const today = new Date().toISOString().split('T')[0]
  const released = releasedParts(collection.parts ?? [], today)
  const firstScoredIndex = Math.max(0, released.length - SCORED_FILMS_PER_COLLECTION)

  const films: FranchiseFilm[] = await Promise.all(
    released.map(async (part, index) => {
      const scored = index >= firstScoredIndex
      return {
        tmdb_id: part.id,
        title: part.title,
        release_date: part.release_date,
        poster_url: posterUrl(part.poster_path),
        rt_score: scored ? await fetchTomatometer(part.id, mdblistApiKey) : null,
      }
    })
  )

  return { collection_id: collection.id, collection_name: collection.name, films }
}

async function resolveHistory(
  tmdbId: number,
  tmdbToken: string,
  mdblistApiKey: string,
  collectionRecords: Map<number, Promise<CollectionRecord>>
): Promise<FranchiseHistory | null> {
  const ref = await cachedTmdbFetch<MovieCollectionRef>(
    buildCacheKey('movie_collection', { tmdb_id: tmdbId }),
    TTL_SECONDS,
    () => fetchMovieCollectionRef(tmdbId, tmdbToken),
    log
  )
  if (ref.collection_id == null) return null

  // One collection fetch per batch even when several of its films are asked
  // for together -- the same sequel and its prequel on one draft page.
  let recordPromise = collectionRecords.get(ref.collection_id)
  if (!recordPromise) {
    const collectionId = ref.collection_id
    recordPromise = cachedTmdbFetch<CollectionRecord>(
      buildCacheKey('franchise_collection', { collection_id: collectionId }),
      TTL_SECONDS,
      () => fetchCollectionRecord(collectionId, tmdbToken, mdblistApiKey),
      log
    )
    collectionRecords.set(collectionId, recordPromise)
  }

  return historyForMovie(await recordPromise, ref)
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function drain(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain))
  return results
}

function parseTmdbIds(body: unknown): number[] | null {
  const ids = (body as Partial<GetFranchiseHistoryRequest> | null)?.tmdb_ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST) return null
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) return null
  return [...new Set(ids)]
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authError = await authenticateUserOrServiceRole(req)
    if (authError) return authError

    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      log.error('TMDB_API_KEY not configured')
      return errorResponse('Movie details service not configured', 503)
    }
    // Without a scores key the history still lists the films, just unscored.
    const mdblistApiKey = Deno.env.get('MDBLIST_API_KEY') ?? ''

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const tmdbIds = parseTmdbIds(body)
    if (!tmdbIds) {
      return errorResponse(`tmdb_ids must be 1-${MAX_IDS_PER_REQUEST} positive integers`, 400)
    }

    const collectionRecords = new Map<number, Promise<CollectionRecord>>()

    // One movie failing (deleted on TMDb, a rate limit on a cache miss) must
    // not blank the whole grid: it answers null and the rest still render.
    const results = await mapWithConcurrency(tmdbIds, CONCURRENCY, async (tmdbId) => {
      try {
        return await resolveHistory(tmdbId, tmdbToken, mdblistApiKey, collectionRecords)
      } catch (error) {
        log.warn('Franchise history unavailable', { tmdb_id: tmdbId, error: serializeError(error) })
        return null
      }
    })

    const histories: GetFranchiseHistoryResponse['histories'] = Object.fromEntries(
      tmdbIds.map((tmdbId, index) => [String(tmdbId), results[index]])
    )

    return jsonResponse({ histories } satisfies GetFranchiseHistoryResponse)
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
