import { getMovieDetails, hasValidMovieMetadata, type MovieDetailsResponse } from './movie-details.ts'
import { TMDbApiError } from './tmdb.ts'
import { serializeError, type Logger } from './logger.ts'

/**
 * The movie snapshot a pickup bid carries (`pickup_bids.movie_data`). It is
 * shown on bid cards, emails and Discord, decides release-date eligibility for
 * a movie with no `movies` row yet, and becomes that row when the bid wins.
 *
 * So it only ever comes from a trusted source: the `movies` row when one
 * exists, else TMDb. A request's own `movie_data` is never read -- trusting it
 * let a bidder plant a title or poster in every league, or bid on a released
 * film by claiming a future release date.
 */
export interface BidMovieData {
  title: string
  overview: string | null
  poster_url: string | null
  release_date: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

export class BidMovieLookupError extends Error {
  constructor(message: string, readonly status: 404 | 503) {
    super(message)
  }
}

const LOOKUP_FAILED = 'Movie details could not be verified. Please try again.'

export function bidMovieDataFromRow(row: {
  title: string
  overview: string | null
  poster_url: string | null
  release_date: string | null
  vote_average: number | null
  popularity: number | null
}): BidMovieData {
  return {
    title: row.title,
    overview: row.overview,
    poster_url: row.poster_url,
    release_date: row.release_date,
    vote_average: row.vote_average ?? 0,
    popularity: row.popularity ?? 0,
    genre_ids: [],
  }
}

export function bidMovieDataFromDetails(details: MovieDetailsResponse): BidMovieData {
  return {
    title: details.title.trim(),
    overview: details.overview ?? null,
    poster_url: details.poster_url ?? null,
    release_date: details.release_date || null,
    vote_average: details.vote_average ?? 0,
    // The details endpoint has no popularity; nothing reads it from a bid.
    popularity: 0,
    genre_ids: (details.genres ?? []).map((genre) => genre.id),
  }
}

/** Canonical TMDb metadata for a movie with no `movies` row yet. */
export async function lookupBidMovieData(tmdbId: number, log: Logger): Promise<BidMovieData> {
  let details: MovieDetailsResponse
  try {
    details = await getMovieDetails(tmdbId, log)
  } catch (error) {
    if (error instanceof TMDbApiError && error.status === 404) {
      throw new BidMovieLookupError('Movie not found', 404)
    }
    log.warn('Bid movie lookup failed', { tmdb_id: tmdbId, error: serializeError(error) })
    throw new BidMovieLookupError(LOOKUP_FAILED, 503)
  }
  // Cache hits skip the fetch-time validation, so check here too.
  if (!hasValidMovieMetadata(details, tmdbId)) {
    throw new BidMovieLookupError(LOOKUP_FAILED, 503)
  }
  return bidMovieDataFromDetails(details)
}
