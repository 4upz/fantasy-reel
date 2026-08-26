import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  internalErrorResponse,
  authenticateUserOrServiceRole,
  createServiceClient,
} from '../_shared/utils.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { buildCacheKey, cachedTmdbFetch } from '../_shared/tmdb-cache.ts'
import { tmdbGetJson } from '../_shared/tmdb.ts'
import { fetchMDBListRatings } from '../_shared/scoring.ts'
import {
  historyForMovie,
  recordTtlSeconds,
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
 * MDBList calls this function may spend per UTC day, across every user and
 * league. MDBList allows ~1000/day and the nightly score sync (which decides
 * real fantasy points) draws on the same account; this feature is context,
 * so it gets a slice and the sync keeps the rest. Past the budget, films
 * render unscored and the record is retried in an hour.
 */
const MDBLIST_DAILY_BUDGET = 300
const MDBLIST_BUDGET_API = 'mdblist'

/**
 * Which collection a movie belongs to never changes, so that layer keeps a
 * week regardless. The collection record's own TTL depends on whether every
 * score landed -- see recordTtlSeconds.
 */
const COLLECTION_REF_TTL_SECONDS = 7 * 24 * 60 * 60

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

/** A film's Tomatometer, and whether a missing one might still turn up. */
interface ScoreLookup {
  score: number | null
  /** True when the lookup failed (rate limit, outage) rather than found nothing. */
  failed: boolean
}

/**
 * The Tomatometer for one released film from MDBList. A failed lookup is
 * reported as such, not silently folded into "no score": the record it lands
 * in is then cached briefly so the film is retried, instead of showing "not
 * rated" for a week because MDBList happened to be rate-limited.
 */
async function fetchTomatometer(tmdbId: number, mdblistApiKey: string): Promise<ScoreLookup> {
  const { ratings, error } = await fetchMDBListRatings(tmdbId, mdblistApiKey)
  if (error) {
    log.warn('Tomatometer lookup failed for franchise film', { tmdb_id: tmdbId, error })
    return { score: null, failed: true }
  }
  return { score: ratings.find((r) => r.source === 'rotten_tomatoes')?.score ?? null, failed: false }
}

/** The service client, or null when this runtime cannot build one. */
function serviceClientOrNull(): SupabaseClient | null {
  try {
    return createServiceClient()
  } catch (error) {
    log.warn('Service client unavailable; skipping local scores and budget', {
      error: serializeError(error),
    })
    return null
  }
}

/**
 * Tomatometers already in the database for these films. A film that has been
 * on any roster has its RT score in `reviews` from the nightly sync, so
 * asking MDBList again would spend budget on an answer we hold.
 */
async function fetchLocalTomatometers(
  client: SupabaseClient | null,
  tmdbIds: number[]
): Promise<Map<number, number>> {
  if (!client || tmdbIds.length === 0) return new Map()

  const { data, error } = await client
    .from('movies')
    .select('tmdb_id, reviews!inner(score)')
    .eq('reviews.source', 'rotten_tomatoes')
    .in('tmdb_id', tmdbIds)

  if (error) {
    // Only costs a few MDBList calls, so degrade rather than fail the record.
    log.warn('Local Tomatometer lookup failed', { error: error.message })
    return new Map()
  }

  const scores = new Map<number, number>()
  for (const row of (data ?? []) as Array<{ tmdb_id: number; reviews: Array<{ score: number | null }> }>) {
    const score = row.reviews?.[0]?.score
    if (score != null) scores.set(row.tmdb_id, score)
  }
  return scores
}

/**
 * How many MDBList calls this record may make right now. Fails closed: if
 * the budget cannot be consulted, nothing is spent -- the record is cached
 * briefly (incomplete) and tried again in an hour.
 */
async function reserveMdblistCalls(
  client: SupabaseClient | null,
  requested: number
): Promise<number> {
  if (!client || requested === 0) return 0

  const { data, error } = await client.rpc('reserve_external_api_calls', {
    p_api: MDBLIST_BUDGET_API,
    p_requested: requested,
    p_daily_limit: MDBLIST_DAILY_BUDGET,
  })

  if (error) {
    log.warn('MDBList budget unavailable; spending nothing', { error: error.message })
    return 0
  }

  const granted = Number(data ?? 0)
  if (granted < requested) {
    log.warn('MDBList daily budget exhausted for franchise history', {
      requested,
      granted,
      daily_budget: MDBLIST_DAILY_BUDGET,
    })
  }
  return granted
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

  // Only the films a history can show get a score lookup. A 30-part series
  // would otherwise cost 30 MDBList calls the first time anyone looks at it,
  // for entries nobody sees; older ones stay unscored on purpose.
  const scorable = released.slice(-MAX_PRIOR_FILMS)
  const client = serviceClientOrNull()
  const local = await fetchLocalTomatometers(client, scorable.map((part) => part.id))

  // Budget covers only what the database could not answer. The newest films
  // are scored first, so a partial grant still lands on the ones that
  // matter most for predicting the next entry.
  const needsLookup = scorable.filter((part) => !local.has(part.id)).reverse()
  const granted = await reserveMdblistCalls(client, needsLookup.length)
  const lookups = new Map<number, ScoreLookup>()
  await Promise.all(
    needsLookup.slice(0, granted).map(async (part) => {
      lookups.set(part.id, await fetchTomatometer(part.id, mdblistApiKey))
    })
  )

  const budgetShort = granted < needsLookup.length
  const anyFailed = [...lookups.values()].some((lookup) => lookup.failed)

  const films: FranchiseFilm[] = released.map((part) => ({
    tmdb_id: part.id,
    title: part.title,
    release_date: part.release_date,
    poster_url: posterUrl(part.poster_path),
    rt_score: local.get(part.id) ?? lookups.get(part.id)?.score ?? null,
  }))

  return {
    collection_id: collection.id,
    collection_name: collection.name,
    films,
    incomplete: budgetShort || anyFailed,
  }
}

async function resolveHistory(
  tmdbId: number,
  tmdbToken: string,
  mdblistApiKey: string,
  collectionRecords: Map<number, Promise<CollectionRecord>>
): Promise<FranchiseHistory | null> {
  const ref = await cachedTmdbFetch<MovieCollectionRef>(
    buildCacheKey('movie_collection', { tmdb_id: tmdbId }),
    COLLECTION_REF_TTL_SECONDS,
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
      recordTtlSeconds,
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
