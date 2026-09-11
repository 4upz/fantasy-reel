import { buildCacheKey, cachedTmdbFetch } from './tmdb-cache.ts'
import { TMDbApiError, tmdbGetJson } from './tmdb.ts'
import type { Logger } from './logger.ts'

/**
 * The `/3/movie/{id}?append_to_response=credits` payload: the movie fields
 * plus a nested `credits` object. Appending is one round trip instead of the
 * two sequential calls this used to make, and TMDb bills it as one request.
 */
interface TMDbMovieDetails {
  id: number
  imdb_id: string | null
  title: string
  tagline: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  budget: number
  revenue: number
  genres: Array<{ id: number; name: string }>
  production_companies: Array<{ id: number; name: string }>
  credits?: TMDbCredits
}

interface TMDbCredits {
  cast?: Array<{
    id: number
    name: string
    character: string
    profile_path: string | null
    order: number
  }>
  crew?: Array<{
    id: number
    name: string
    job: string
    department: string
  }>
}

interface CastMember {
  id: number
  name: string
  character: string
  profile_url: string | null
}

export interface MovieDetailsResponse {
  tmdb_id: number
  imdb_id: string | null
  title: string
  tagline: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: string
  poster_url: string | null
  backdrop_url: string | null
  vote_average: number
  vote_count: number
  genres: Array<{ id: number; name: string }>
  cast: CastMember[]
  director: string | null
}

const CAST_LIMIT = 10
const RELEASED_TTL_SECONDS = 7 * 24 * 60 * 60
const UNRELEASED_TTL_SECONDS = 24 * 60 * 60

/**
 * A released movie's details (runtime, cast, tagline) essentially never
 * change, so it caches for a week. An unreleased one still gains cast members
 * and moves its release date, so it caches for a day.
 *
 * The TTL is derived from the payload rather than the request because
 * release_date is only known once TMDb has answered -- there is no first
 * request where a fixed TTL would be correct.
 */
function ttlSecondsFor(details: MovieDetailsResponse): number {
  const today = new Date().toISOString().split('T')[0]
  return details.release_date && details.release_date < today
    ? RELEASED_TTL_SECONDS
    : UNRELEASED_TTL_SECONDS
}

function toMovieDetailsResponse(movieDetails: TMDbMovieDetails): MovieDetailsResponse {
  const credits = movieDetails.credits

  const cast: CastMember[] = (credits?.cast || [])
    .slice(0, CAST_LIMIT)
    .map((member) => ({
      id: member.id,
      name: member.name,
      character: member.character,
      profile_url: member.profile_path
        ? `https://image.tmdb.org/t/p/w185${member.profile_path}`
        : null,
    }))

  return {
    tmdb_id: movieDetails.id,
    imdb_id: movieDetails.imdb_id,
    title: movieDetails.title,
    tagline: movieDetails.tagline,
    overview: movieDetails.overview,
    release_date: movieDetails.release_date,
    runtime: movieDetails.runtime,
    status: movieDetails.status,
    poster_url: movieDetails.poster_path
      ? `https://image.tmdb.org/t/p/w500${movieDetails.poster_path}`
      : null,
    backdrop_url: movieDetails.backdrop_path
      ? `https://image.tmdb.org/t/p/original${movieDetails.backdrop_path}`
      : null,
    vote_average: movieDetails.vote_average,
    vote_count: movieDetails.vote_count,
    genres: movieDetails.genres,
    cast,
    director: credits?.crew?.find((c) => c.job === 'Director')?.name || null,
  }
}

async function fetchMovieDetails(tmdbId: number, tmdbToken: string): Promise<MovieDetailsResponse> {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US&append_to_response=credits`
  const details = toMovieDetailsResponse(await tmdbGetJson<TMDbMovieDetails>(url, tmdbToken))
  // Reject malformed successful responses before the shared cache can retain them.
  if (!hasValidMovieMetadata(details, tmdbId)) {
    throw new TMDbApiError(502, 'TMDb returned invalid movie metadata')
  }
  return details
}

export function hasValidMovieMetadata(details: MovieDetailsResponse, tmdbId: number): boolean {
  if (details?.tmdb_id !== tmdbId || typeof details.title !== 'string' ||
    !details.title.trim() || details.title.length > 500) return false
  const date = details.release_date
  // Unknown dates are useful in previews; drafting applies eligibility separately.
  if (date === null || date === '') return true
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
}

export class MovieDetailsUnavailableError extends Error {
  constructor() { super('Movie details service not configured') }
}

/** Shared trusted source for previews and draft eligibility. Cache hits need no token. */
export function getMovieDetails(tmdbId: number, log: Logger): Promise<MovieDetailsResponse> {
  return cachedTmdbFetch<MovieDetailsResponse>(
    buildCacheKey('movie_details', { tmdb_id: tmdbId }),
    ttlSecondsFor,
    () => {
      const token = Deno.env.get('TMDB_API_KEY')
      if (!token) throw new MovieDetailsUnavailableError()
      return fetchMovieDetails(tmdbId, token)
    },
    log,
  )
}
