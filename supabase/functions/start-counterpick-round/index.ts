import {
  jsonResponse, errorResponse, handleCorsPreflightRequest, authenticateRequest,
  isAuthError, isValidUUID, createServiceClient, internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { DraftSubmissionError, readDraftBody, throwDraftRpcError } from '../_shared/draft-submissions.ts'

const log = createLogger('start-counterpick-round')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse
  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { league_id } = await readDraftBody(req)
    if (typeof league_id !== 'string' || !isValidUUID(league_id)) return errorResponse('Valid league_id is required', 400)
    const { data, error } = await createServiceClient().rpc('transition_draft_phase', {
      p_league_id: league_id, p_user_id: authResult.user.id, p_action: 'start_counterpicks',
    })
    throwDraftRpcError(error)
    return jsonResponse({ ...data, message: 'Counterpick round started' })
  } catch (error) {
    if (error instanceof DraftSubmissionError) return errorResponse(error.message, error.status)
    return internalErrorResponse(error, log)
  }
})
