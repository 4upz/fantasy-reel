import {
  jsonResponse, errorResponse, handleCorsPreflightRequest, authenticateRequest,
  isAuthError, isValidUUID, createServiceClient, internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { DraftMovieMetadataError, resolveDraftMovieMetadata } from '../_shared/draft-movie-metadata.ts'
import { DraftSubmissionError, readDraftBody, findDraftReplay, parseDraftAttempt, throwDraftRpcError } from '../_shared/draft-submissions.ts'

const log = createLogger('draft-pick')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse
  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult
    const body = await readDraftBody(req)
    const { league_id, tmdb_id } = body
    if (typeof league_id !== 'string' || !isValidUUID(league_id)) return errorResponse('Valid league_id is required', 400)
    if (typeof tmdb_id !== 'number' || !Number.isSafeInteger(tmdb_id) || tmdb_id <= 0 || tmdb_id > 2_147_483_647) {
      return errorResponse('Valid tmdb_id is required', 400)
    }
    const attempt = parseDraftAttempt(body)
    const service = createServiceClient()
    const replay = await findDraftReplay(service, {
      ...attempt, leagueId: league_id, userId: user.id, kind: 'draft', tmdbId: tmdb_id,
    })
    let expectedPick = replay?.expected_pick ?? attempt.expectedPick
    let movieId = replay?.movie_id
    if (!replay) {
      const { data: league, error: leagueError } = await service.from('leagues')
        .select('status,season_year').eq('id', league_id).maybeSingle()
      if (leagueError) throw leagueError
      if (!league) return errorResponse('League not found', 404)
      if (league.status !== 'drafting') {
        return errorResponse(league.status === 'setup' ? 'Draft has not started yet' : 'Draft has already ended', 400)
      }
      // Fast permission check avoids calling TMDb for an out-of-turn selection.
      // The transaction repeats all checks after metadata resolution.
      const { data: next, error: nextError } = await service.rpc('get_next_draft_pick', { p_league_id: league_id })
      if (nextError) throw nextError
      if (!next?.[0]) return errorResponse('Draft is complete', 400)
      if (next[0].user_id !== user.id) return errorResponse('It is not your turn to pick', 403)
      if (expectedPick === undefined) {
        const { count, error } = await service.from('draft_picks')
          .select('id', { count: 'exact', head: true }).eq('league_id', league_id)
        if (error) throw error
        expectedPick = (count ?? 0) + 1
      }
      // Keep external work outside the league lock. These canonical fields also
      // repair older incomplete movie rows; SQL checks eligibility again.
      const metadata = await resolveDraftMovieMetadata(tmdb_id, league.season_year, log)
      const { data: movie, error: movieError } = await service.from('movies')
        .upsert(metadata, { onConflict: 'tmdb_id' }).select('id').single()
      if (movieError || !movie) {
        log.error('Failed to save canonical draft movie', { tmdb_id, error: serializeError(movieError) })
        return errorResponse('Failed to save movie details. Please try again.', 500)
      }
      movieId = movie.id
    }
    const { data, error } = await service.rpc('commit_draft_pick', {
      p_league_id: league_id, p_user_id: user.id, p_movie_id: movieId,
      p_expected_pick: expectedPick, p_request_id: attempt.requestId,
    })
    throwDraftRpcError(error)
    return jsonResponse(data, 201)
  } catch (error) {
    if (error instanceof DraftMovieMetadataError || error instanceof DraftSubmissionError) {
      return errorResponse(error.message, error.status)
    }
    return internalErrorResponse(error, log)
  }
})
