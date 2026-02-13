/**
 * Shared scoring utilities for movie score processing.
 *
 * Used by: process-movie-scores, update-scores
 */

// --- Types ---

export interface OMDbRating {
  Source: string
  Value: string
}

export interface OMDbResponse {
  Response: string
  Error?: string
  imdbID?: string
  Title?: string
  Ratings?: OMDbRating[]
}

export interface TMDbExternalIds {
  imdb_id?: string
  facebook_id?: string
  instagram_id?: string
  twitter_id?: string
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

// --- Rating normalization ---

interface RatingParser {
  source: string
  pattern: RegExp
  normalize: (match: RegExpMatchArray) => number
}

const RATING_PARSERS: Record<string, RatingParser> = {
  'Internet Movie Database': {
    source: 'imdb',
    pattern: /^([\d.]+)\/10$/,
    normalize: (match) => Math.round(parseFloat(match[1]) * 10),
  },
  'Rotten Tomatoes': {
    source: 'rotten_tomatoes',
    pattern: /^(\d+)%$/,
    normalize: (match) => parseInt(match[1]),
  },
  'Metacritic': {
    source: 'metacritic',
    pattern: /^(\d+)\/100$/,
    normalize: (match) => parseInt(match[1]),
  },
}

/**
 * Normalize an OMDb rating to a 0-100 scale.
 * Returns null source/score for unrecognized rating sources.
 */
export function normalizeRating(rating: OMDbRating): NormalizedRating {
  const parser = RATING_PARSERS[rating.Source]
  if (!parser) {
    return { source: null, score: null, raw: rating.Value }
  }

  const match = rating.Value.match(parser.pattern)
  const score = match ? parser.normalize(match) : null

  return { source: parser.source, score, raw: rating.Value }
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
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`,
      {
        headers: {
          Authorization: `Bearer ${tmdbApiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!res.ok) return null
    const data: TMDbExternalIds = await res.json()
    return data.imdb_id || null
  } catch {
    return null
  }
}
