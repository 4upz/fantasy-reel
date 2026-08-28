/**
 * Shared scoring utilities for movie score processing.
 *
 * Used by: update-scores
 */

import { fetchWithRetry } from './http.ts'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/scoring')

// --- Types ---

export interface MDBListRating {
  source: string
  value: number
  score: number
  votes: number
}

export interface MDBListResponse {
  title: string
  ratings: MDBListRating[]
  budget?: number | null
  revenue?: number | null
  certification?: string | null
  released?: string | null
  production_companies?: Array<{ id: number; name: string }>
}

/** Film facts MDBList returns with the ratings; stored on film_corpus by ingestion. */
export interface MDBListDetails {
  budget: number | null
  revenue: number | null
  certification: string | null
  released: string | null
  company_ids: number[]
  rt_critic_votes: number | null
}

export interface TMDbExternalIds {
  imdb_id?: string
}

export interface NormalizedRating {
  source: string | null
  score: number | null
  raw: string
}

export interface MovieRecord {
  id: string
  tmdb_id: number
  imdb_id: string | null
  title: string
}

// --- MDBList source mapping ---

/** Maps MDBList source names to our DB source names */
export const MDBLIST_SOURCE_MAP: Record<string, string> = {
  imdb: 'imdb',
  tomatoes: 'rotten_tomatoes',
  metacritic: 'metacritic',
}

/** Formats MDBList `value` to a human-readable raw_score string matching existing DB convention */
const RAW_SCORE_FORMATTERS: Record<string, (value: number) => string> = {
  imdb: (v) => `${v}/10`,
  tomatoes: (v) => `${v}%`,
  metacritic: (v) => `${v}/100`,
}

// --- MDBList API ---

/**
 * Fetch ratings from MDBList for a movie identified by TMDb ID.
 * Returns normalized ratings for our 3 professional sources (IMDb, RT, Metacritic).
 * Filters out sources with null/undefined scores or zero votes.
 */
export async function fetchMDBListRatings(
  tmdbId: number,
  apiKey: string
): Promise<{ ratings: NormalizedRating[]; details?: MDBListDetails; status?: number; error?: string }> {
  if (!apiKey) {
    return { ratings: [], error: 'MDBList API key not configured' }
  }

  try {
    const res = await fetchWithRetry(
      `https://api.mdblist.com/tmdb/movie/${tmdbId}?apikey=${apiKey}`,
      undefined,
      { timeoutMs: 10_000 }
    )

    if (!res.ok) {
      const status = res.status
      if (status === 401) return { ratings: [], status, error: 'MDBList API authentication failed' }
      if (status === 404) return { ratings: [], status, error: 'Movie not found on MDBList' }
      if (status === 429) return { ratings: [], status, error: 'MDBList API rate limit exceeded' }
      return { ratings: [], status, error: `MDBList API error: ${status}` }
    }

    const data: MDBListResponse = await res.json()
    const details = toDetails(data)

    if (!data.ratings || !Array.isArray(data.ratings)) {
      return { ratings: [], details }
    }

    const ratings: NormalizedRating[] = []
    for (const r of data.ratings) {
      const dbSource = MDBLIST_SOURCE_MAP[r.source]
      if (!dbSource) continue
      if (r.score == null) continue
      if (!r.votes) continue

      const formatter = RAW_SCORE_FORMATTERS[r.source]
      ratings.push({
        source: dbSource,
        score: r.score,
        raw: formatter ? formatter(r.value) : `${r.value}`,
      })
    }

    return { ratings, details }
  } catch (err) {
    log.warn('Failed to fetch ratings from MDBList', { tmdb_id: tmdbId, error: serializeError(err) })
    return { ratings: [], error: 'Failed to fetch ratings from MDBList' }
  }
}

/**
 * True when a lookup for a movie polled *before* release simply has no
 * Tomatometer yet: MDBList has no entry for it (404), has an entry with no
 * ratings, or has ratings from other sources only.
 *
 * Spec §8.1: pre-release polling asks MDBList every day about movies that are
 * mostly in exactly that state, so all three are the expected steady state
 * rather than failures. Recording them in a run's `errors` would mark every
 * nightly run degraded and bury the failures that do need an operator --
 * auth (401), rate limiting (429), server errors, network errors -- which all
 * stay failures here.
 */
export function isUnratedPrerelease(
  outcome: { ratings: NormalizedRating[]; status?: number; error?: string }
): boolean {
  if (outcome.error) return outcome.status === 404
  if (outcome.ratings.length === 0) return true
  return !outcome.ratings.some((r) => r.source === 'rotten_tomatoes')
}

function toDetails(data: MDBListResponse): MDBListDetails {
  const tomatoes = Array.isArray(data.ratings) ? data.ratings.find((r) => r.source === 'tomatoes') : undefined
  return {
    budget: typeof data.budget === 'number' && data.budget > 0 ? data.budget : null,
    revenue: typeof data.revenue === 'number' && data.revenue > 0 ? data.revenue : null,
    certification: data.certification || null,
    released: data.released || null,
    company_ids: (data.production_companies ?? []).map((c) => c.id).filter((id) => typeof id === 'number'),
    rt_critic_votes: tomatoes && tomatoes.votes ? tomatoes.votes : null,
  }
}

// --- TMDb helpers ---

/**
 * Fetch the IMDB ID for a movie from TMDb's external_ids endpoint.
 * Returns null if the fetch fails or no IMDB ID is available.
 */
export async function fetchImdbId(
  tmdbId: number,
  tmdbApiKey: string
): Promise<string | null> {
  try {
    const res = await fetchWithRetry(
      `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`,
      {
        headers: {
          Authorization: `Bearer ${tmdbApiKey}`,
          'Content-Type': 'application/json',
        },
      },
      { timeoutMs: 10_000 }
    )
    if (!res.ok) return null
    const data: TMDbExternalIds = await res.json()
    return data.imdb_id || null
  } catch (err) {
    log.warn('Failed to fetch IMDb ID from TMDb', { tmdb_id: tmdbId, error: serializeError(err) })
    return null
  }
}
