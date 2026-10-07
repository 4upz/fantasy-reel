import { jsonResponse, errorResponse, handleCorsPreflightRequest, internalErrorResponse, authenticateCaller } from '../_shared/utils.ts'
import { throttleUser } from '../_shared/rate-limit.ts'
import { createLogger } from '../_shared/logger.ts'
import { TMDbApiError, tmdbErrorResponse } from '../_shared/tmdb.ts'
import { getMovieDetails, MovieDetailsUnavailableError } from '../_shared/movie-details.ts'

const log = createLogger('get-movie-details')

interface GetMovieDetailsRequest {
  tmdb_id: number
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Any signed-in user, or the service role (the Discord bot) -- see
    // authenticateCaller for why that is the whole check here.
    const caller = await authenticateCaller(req)
    if (caller instanceof Response) return caller

    let params: GetMovieDetailsRequest
    try {
      params = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { tmdb_id } = params

    if (!Number.isSafeInteger(tmdb_id) || tmdb_id <= 0 || tmdb_id > 2_147_483_647) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    const throttled = await throttleUser('movie_details', caller.userId, log)
    if (throttled) return throttled

    const payload = await getMovieDetails(tmdb_id, log)

    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof MovieDetailsUnavailableError) {
      log.error('TMDB_API_KEY not configured')
      return errorResponse(error.message, 503)
    }
    // Only reached when the cache had nothing to fall back on -- a hit or an
    // expired entry answers a rate-limited or failing TMDb before this.
    if (error instanceof TMDbApiError) {
      return tmdbErrorResponse(error, log, 'Failed to fetch movie details', { notFoundMessage: 'Movie not found' })
    }
    return internalErrorResponse(error, log)
  }
})
