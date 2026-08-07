import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  createServiceClient,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { activateLeague } from '../_shared/activation.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('skip-counterpick-round')

interface SkipCounterpickRoundRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    const { league_id }: SkipCounterpickRoundRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    const serviceClient = createServiceClient()

    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can skip the counterpick round', 403)
    }

    if (league.status !== 'drafting') {
      return errorResponse(`Cannot skip counterpick round: league is in '${league.status}' status`, 400)
    }

    if (!league.draft_counterpick_slots || league.draft_counterpick_slots <= 0) {
      return errorResponse('League has no counterpick slots configured', 400)
    }

    const result = await activateLeague(serviceClient, league_id, 'drafting')
    if (result.error) {
      return errorResponse(result.error, 409)
    }

    const { data: updatedLeague } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    return jsonResponse({
      league: updatedLeague,
      message: 'Counterpick round skipped, league is now active',
    }, 200)

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
