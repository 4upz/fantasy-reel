import { jsonResponse, errorResponse, handleCorsPreflightRequest, internalErrorResponse } from '../_shared/utils.ts'
import { fetchWithRetry } from '../_shared/http.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('get-movie-details')

interface GetMovieDetailsRequest {
  tmdb_id: number
}

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
}

interface TMDbCredits {
  id: number
  cast: Array<{
    id: number
    name: string
    character: string
    profile_path: string | null
    order: number
  }>
  crew: Array<{
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

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      console.error('TMDB_API_KEY not configured')
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

    const authHeaders = {
      'Authorization': `Bearer ${tmdbToken}`,
      'Content-Type': 'application/json',
    }

    // Fetch movie details
    const detailsUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}?language=en-US`
    const detailsResponse = await fetchWithRetry(detailsUrl, { headers: authHeaders }, { timeoutMs: 10_000, retries: 1 })

    if (!detailsResponse.ok) {
      if (detailsResponse.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (detailsResponse.status === 404) {
        return errorResponse('Movie not found', 404)
      }
      if (detailsResponse.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      console.error('TMDb API error:', detailsResponse.status)
      return errorResponse('Failed to fetch movie details', 502)
    }

    const movieDetails: TMDbMovieDetails = await detailsResponse.json()

    // Fetch credits
    const creditsUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}/credits?language=en-US`
    const creditsResponse = await fetchWithRetry(creditsUrl, { headers: authHeaders }, { timeoutMs: 10_000, retries: 1 })

    let credits: TMDbCredits | null = null
    if (creditsResponse.ok) {
      credits = await creditsResponse.json()
    } else {
      console.warn('Failed to fetch credits:', creditsResponse.status)
    }

    // Get top 10 cast members
    const cast: CastMember[] = (credits?.cast || [])
      .slice(0, 10)
      .map((member) => ({
        id: member.id,
        name: member.name,
        character: member.character,
        profile_url: member.profile_path
          ? `https://image.tmdb.org/t/p/w185${member.profile_path}`
          : null,
      }))

    // Get director from crew
    const director = credits?.crew?.find((c) => c.job === 'Director')?.name || null

    const response: MovieDetailsResponse = {
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
      director,
    }

    return jsonResponse(response)
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
