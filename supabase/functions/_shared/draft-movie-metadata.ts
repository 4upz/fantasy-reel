import { getMovieDetails, hasValidMovieMetadata, type MovieDetailsResponse } from './movie-details.ts'
import { TMDbApiError } from './tmdb.ts'
import { isUpcomingMovie } from './utils.ts'
import { serializeError, type Logger } from './logger.ts'

export class DraftMovieMetadataError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 503) {
    super(message)
  }
}

const LOOKUP_FAILED = 'Movie details could not be verified. Please try again.'

/** Only these canonical metadata columns may be written; fantasy scores stay intact. */
export function toDraftMovieMetadata(tmdbId: number, details: MovieDetailsResponse, seasonYear: number) {
  if (!hasValidMovieMetadata(details, tmdbId)) {
    throw new DraftMovieMetadataError(LOOKUP_FAILED, 503)
  }

  const releaseDate = details.release_date || null
  const eligibility = isUpcomingMovie(releaseDate, seasonYear)
  if (!eligibility.valid) {
    throw new DraftMovieMetadataError(`This movie cannot be drafted: ${eligibility.reason}`, 400)
  }
  if (details.status === 'Canceled') {
    throw new DraftMovieMetadataError('This movie is not available for drafting', 400)
  }

  return {
    tmdb_id: tmdbId,
    title: details.title.trim(),
    overview: details.overview ?? null,
    poster_url: details.poster_url ?? null,
    backdrop_url: details.backdrop_url ?? null,
    release_date: releaseDate!,
    status: 'upcoming' as const,
    last_synced_at: new Date().toISOString(),
  }
}

export async function resolveDraftMovieMetadata(tmdbId: number, seasonYear: number, log: Logger) {
  let details: MovieDetailsResponse
  try {
    details = await getMovieDetails(tmdbId, log)
  } catch (error) {
    if (error instanceof TMDbApiError && error.status === 404) {
      throw new DraftMovieMetadataError('Movie not found', 404)
    }
    log.warn('Draft movie lookup failed', { tmdb_id: tmdbId, error: serializeError(error) })
    throw new DraftMovieMetadataError(LOOKUP_FAILED, 503)
  }
  return toDraftMovieMetadata(tmdbId, details, seasonYear)
}
