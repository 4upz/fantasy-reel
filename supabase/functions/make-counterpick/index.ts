import {
  jsonResponse, errorResponse, handleCorsPreflightRequest, authenticateRequest,
  isAuthError, isValidUUID, createServiceClient, internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { DraftSubmissionError, readDraftBody, findDraftReplay, parseDraftAttempt, throwDraftRpcError } from '../_shared/draft-submissions.ts'

const log = createLogger('make-counterpick')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse
  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult
    const body = await readDraftBody(req)
    const { league_id, movie_id } = body
    if (typeof league_id !== 'string' || !isValidUUID(league_id)) return errorResponse('Valid league_id is required', 400)
    if (typeof movie_id !== 'string' || !isValidUUID(movie_id)) return errorResponse('Valid movie_id is required', 400)
    const attempt = parseDraftAttempt(body)
    const service = createServiceClient()
    const submission = { ...attempt, leagueId: league_id, userId: user.id, kind: 'counterpick' as const, movieId: movie_id }
    let replay = await findDraftReplay(service, submission)
    let expectedPick = replay?.expected_pick ?? attempt.expectedPick
    if (!replay) {
      const { data: league, error } = await service.from('leagues').select('status').eq('id', league_id).maybeSingle()
      if (error) throw error
      if (!league) return errorResponse('League not found', 404)
      if (league.status !== 'counterpicking') {
        // The final counterpick can commit after the first receipt lookup and
        // activate the league. Prefer its committed replay to a phase rejection.
        replay = await findDraftReplay(service, submission)
        if (!replay) {
          return errorResponse(league.status === 'active' ? 'Use the bidding system for active-phase counterpicks'
            : league.status === 'drafting' ? 'Counterpick round has not started yet'
            : league.status === 'setup' ? 'Draft has not started yet'
            : `Cannot make counterpick: league is in '${league.status}' status`, expectedPick === undefined ? 400 : 409)
        }
        expectedPick = replay.expected_pick
      }
      if (expectedPick === undefined) {
        const { count, error: countError } = await service.from('counterpicks')
          .select('id', { count: 'exact', head: true }).eq('league_id', league_id).eq('phase', 'draft')
        if (countError) throw countError
        expectedPick = (count ?? 0) + 1
      }
    }
    const { data, error } = await service.rpc('commit_counterpick', {
      p_league_id: league_id, p_user_id: user.id, p_movie_id: movie_id,
      p_expected_pick: expectedPick, p_request_id: attempt.requestId,
    })
    throwDraftRpcError(error)
    return jsonResponse(data, 201)
  } catch (error) {
    if (error instanceof DraftSubmissionError) return errorResponse(error.message, error.status)
    return internalErrorResponse(error, log)
  }
})
