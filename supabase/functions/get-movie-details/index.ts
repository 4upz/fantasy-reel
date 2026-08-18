import { jsonResponse, errorResponse, handleCorsPreflightRequest, internalErrorResponse } from '../_shared/utils.ts'
import { fetchWithRetry } from '../_shared/http.ts'
import { createLogger } from '../_shared/logger.ts'
import { cachedTmdbFetch } from '../_shared/tmdb-cache.ts'

const log = createLogger('get-movie-details')

interface GetMovieDetailsRequest {
  tmdb_id: number
}

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

interface MovieDetailsResponse {
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

class TMDbApiError extends Error {
  status: number

  constructor(status: number) {
    super(`TMDb API error: ${status}`)
    this.status = status
  }
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
  const response = await fetchWithRetry(url, {
    headers: {
      'Authorization': `Bearer ${tmdbToken}`,
      'Content-Type': 'application/json',
    },
  }, { timeoutMs: 10_000, retries: 1 })

  if (!response.ok) {
    throw new TMDbApiError(response.status)
  }

  return toMovieDetailsResponse(await response.json() as TMDbMovieDetails)
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      log.error('TMDB_API_KEY not configured')
      return errorResponse('Movie details service not configured', 503)
    }

    let params: GetMovieDetailsRequest
    try {
      params = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { tmdb_id } = params

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    const { payload } = await cachedTmdbFetch<MovieDetailsResponse>(
      `movie_details:${tmdb_id}`,
      ttlSecondsFor,
      () => fetchMovieDetails(tmdb_id, tmdbToken),
      log
    )

    return jsonResponse(payload)
  } catch (error) {
    // Only reached when the cache had nothing to fall back on -- a hit or an
    // expired entry answers a rate-limited or failing TMDb before this.
    if (error instanceof TMDbApiError) {
      if (error.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (error.status === 404) {
        return errorResponse('Movie not found', 404)
      }
      if (error.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      log.error('TMDb API error', { status: error.status })
      return errorResponse('Failed to fetch movie details', 502)
    }
    return internalErrorResponse(error, log)
  }
})
