/**
 * Shared scoring utilities for movie score processing.
 *
 * Used by: update-scores
 */

import { fetchWithRetry } from './http.ts'

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
): Promise<{ ratings: NormalizedRating[]; error?: string }> {
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
      if (res.status === 401) return { ratings: [], error: 'MDBList API authentication failed' }
      if (res.status === 404) return { ratings: [], error: 'Movie not found on MDBList' }
      if (res.status === 429) return { ratings: [], error: 'MDBList API rate limit exceeded' }
      return { ratings: [], error: `MDBList API error: ${res.status}` }
    }

    const data: MDBListResponse = await res.json()

    if (!data.ratings || !Array.isArray(data.ratings)) {
      return { ratings: [] }
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

    return { ratings }
  } catch {
    return { ratings: [], error: 'Failed to fetch ratings from MDBList' }
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
  } catch {
    return null
  }
}
