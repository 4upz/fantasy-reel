/**
 * Get Movie Projections Edge Function -- entrypoint.
 *
 * POST { league_id, tmdb_ids: number[] (1-100) } from a signed-in league
 * member -> GetMovieProjectionsResponse (`_shared/projection-types.ts`).
 * Wiring only; the gate and the reads live in handler.ts (unit tests in
 * ../_shared/get-movie-projections.test.ts).
 */
import {
  authenticateRequest,
  createServiceClient,
  handleCorsPreflightRequest,
  internalErrorResponse,
  isAuthError,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { asProjectionsClient, handleGetMovieProjections } from './handler.ts'

const log = createLogger('get-movie-projections')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    return await handleGetMovieProjections(req, {
      authenticate: async (request) => {
        const result = await authenticateRequest(request)
        return isAuthError(result) ? result : { userId: result.user.id }
      },
      client: asProjectionsClient(createServiceClient()),
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
