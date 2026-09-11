import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

import { DraftSubmissionError, readDraftBody } from '../_shared/draft-submissions.ts'

const log = createLogger('start-draft')

interface StartDraftRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user, supabase: supabaseClient } = authResult

    const { league_id }: StartDraftRequest = await readDraftBody<StartDraftRequest>(req)

    // Validate required fields
    if (typeof league_id !== 'string' || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    // Fetch the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can start the draft', 403)
    }

    // Verify league is in setup status
    if (league.status !== 'setup') {
      return errorResponse(`Cannot start draft: league is already in '${league.status}' status`, 400)
    }

    // Ownership, order preparation, and the phase change share one database lock.
    const { data: started, error: startError } = await supabaseClient.rpc('start_draft', {
      p_league_id: league_id,
    })

    if (startError) {
      if (['PT400', 'PT403', 'PT404', 'PT409'].includes(startError.code)) {
        return errorResponse(startError.message, Number(startError.code.slice(2)))
      }
      log.error('Failed to start draft', { league_id, error: serializeError(startError) })
      return errorResponse('Failed to start draft', 500)
    }

    const { league: updatedLeague, participant_count: participantCount } = started

    return jsonResponse({
      league: updatedLeague,
      message: 'Draft started successfully',
      participant_count: participantCount,
    }, 200)

  } catch (error) {
    if (error instanceof DraftSubmissionError) return errorResponse(error.message, error.status)
    return internalErrorResponse(error, log)
  }
})
