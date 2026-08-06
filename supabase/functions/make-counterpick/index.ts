import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  createServiceClient,
  isUpcomingMovie,
} from '../_shared/utils.ts'
import { activateLeague } from '../_shared/activation.ts'

interface MakeCounterpickRequest {
  league_id: string
  movie_id: string
}

/** The draft pick or pickup that owns the targeted movie, source-agnostic. */
interface CounterpickTarget {
  source: 'draft' | 'pickup'
  id: string
  team_id: string
  counterpicked_by_team_id: string | null
}

interface CounterpickTurnInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
  counterpicks_remaining: number
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    const serviceClient = createServiceClient()

    const { league_id, movie_id }: MakeCounterpickRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!movie_id || !isValidUUID(movie_id)) {
      return errorResponse('Valid movie_id is required', 400)
    }

    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.status !== 'counterpicking') {
      if (league.status === 'active') {
        return errorResponse('Use the bidding system for active-phase counterpicks', 400)
      }
      if (league.status === 'drafting') {
        return errorResponse('Counterpick round has not started yet', 400)
      }
      if (league.status === 'setup') {
        return errorResponse('Draft has not started yet', 400)
      }
      return errorResponse(`Cannot make counterpick: league is in '${league.status}' status`, 400)
    }

    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .select('id, teams(id, name)')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !participant) {
      return errorResponse('You are not a member of this league', 403)
    }

    const team = participant.teams as unknown as { id: string; name: string }
    if (!team) {
      return errorResponse('Team not found for participant', 500)
    }

    const { data: turnData, error: turnError } = await serviceClient.rpc('get_next_counterpick_turn', {
      p_league_id: league_id,
    })

    if (turnError) {
      console.error('Error getting counterpick turn:', turnError)
      return errorResponse('Failed to determine counterpick turn', 500)
    }

    if (!turnData || turnData.length === 0) {
      // No more counterpicks - round should be complete
      return errorResponse('Counterpick round is complete', 400)
    }

    const nextTurn: CounterpickTurnInfo = turnData[0]

    // Verify it's the user's turn
    if (nextTurn.user_id !== user.id) {
      return errorResponse('It is not your turn to counterpick', 403)
    }

    // Movie validation: must exist in this league's draft picks or pickups
    const { data: draftPick } = await serviceClient
      .from('draft_picks')
      .select('id, team_id, counterpicked_by_team_id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .is('dropped_at', null)
      .single()

    let target: CounterpickTarget | null = draftPick
      ? { source: 'draft', id: draftPick.id, team_id: draftPick.team_id, counterpicked_by_team_id: draftPick.counterpicked_by_team_id }
      : null

    if (!target) {
      const { data: pickup } = await serviceClient
        .from('pickups')
        .select('id, team_id, counterpicked_by_team_id')
        .eq('league_id', league_id)
        .eq('movie_id', movie_id)
        .is('dropped_at', null)
        .single()

      if (pickup) {
        target = { source: 'pickup', id: pickup.id, team_id: pickup.team_id, counterpicked_by_team_id: pickup.counterpicked_by_team_id }
      }
    }

    if (!target) {
      return errorResponse('Movie not found in this league draft', 404)
    }

    if (target.team_id === team.id) {
      return errorResponse('Cannot counterpick your own movie', 400)
    }

    if (target.counterpicked_by_team_id) {
      return errorResponse('This movie has already been counterpicked', 400)
    }

    // Belt-and-suspenders: also check counterpicks table directly
    const { data: existingCounterpick } = await serviceClient
      .from('counterpicks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .single()

    if (existingCounterpick) {
      return errorResponse('This movie has already been counterpicked', 400)
    }

    // Fetch the movie row up front: reused for the release-date guard below
    // and again for the response/fantasy_points inversion.
    const { data: movie, error: movieError } = await serviceClient
      .from('movies')
      .select('id, title, poster_url, release_date, fantasy_points')
      .eq('id', movie_id)
      .single()

    if (movieError || !movie) {
      return errorResponse('Movie not found', 404)
    }

    const releaseCheck = isUpcomingMovie(movie.release_date)
    if (!releaseCheck.valid) {
      return errorResponse(`Cannot counterpick this movie: ${releaseCheck.reason}`, 400)
    }

    const { count: pickOrderCount, error: pickOrderError } = await serviceClient
      .from('counterpicks')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('phase', 'draft')

    if (pickOrderError) {
      console.error('Error getting pick order:', pickOrderError)
      return errorResponse('Failed to determine pick order', 500)
    }

    const pickOrder = (pickOrderCount ?? 0) + 1

    const { data: counterpick, error: counterpickError } = await serviceClient
      .from('counterpicks')
      .insert({
        league_id,
        counterpicker_team_id: team.id,
        target_team_id: target.team_id,
        movie_id,
        draft_pick_id: target.source === 'draft' ? target.id : null,
        pickup_id: target.source === 'pickup' ? target.id : null,
        pick_order: pickOrder,
        phase: 'draft',
        fantasy_points: movie.fantasy_points ? -movie.fantasy_points : null,
      })
      .select()
      .single()

    if (counterpickError) {
      console.error('Error creating counterpick:', counterpickError)
      if (counterpickError.code === '23505') {
        // Unique constraint violation - race condition
        return errorResponse('This movie was just counterpicked. Please try again.', 409)
      }
      return errorResponse('Failed to create counterpick', 500)
    }

    const { error: updateError } = await serviceClient
      .from(target.source === 'draft' ? 'draft_picks' : 'pickups')
      .update({ counterpicked_by_team_id: team.id })
      .eq('id', target.id)

    if (updateError) {
      console.error(`Error updating ${target.source}:`, updateError)
      // Continue anyway - counterpick was recorded
    }

    let roundComplete = false
    let nextTurnAfterPick: CounterpickTurnInfo | null = null

    const { data: nextTurnData } = await serviceClient.rpc('get_next_counterpick_turn', {
      p_league_id: league_id,
    })

    if (!nextTurnData || nextTurnData.length === 0) {
      roundComplete = true

      const result = await activateLeague(serviceClient, league_id, 'counterpicking')
      if (result.error) {
        console.error('Failed to activate league:', result.error)
      }
    } else {
      nextTurnAfterPick = nextTurnData[0]
    }

    const { data: targetTeam } = await serviceClient
      .from('teams')
      .select('name')
      .eq('id', target.team_id)
      .single()

    return jsonResponse({
      counterpick: {
        id: counterpick.id,
        league_id: counterpick.league_id,
        counterpicker_team_id: counterpick.counterpicker_team_id,
        target_team_id: counterpick.target_team_id,
        movie_id: counterpick.movie_id,
        draft_pick_id: counterpick.draft_pick_id,
        pick_order: counterpick.pick_order,
        phase: counterpick.phase,
        fantasy_points: counterpick.fantasy_points,
        created_at: counterpick.created_at,
      },
      movie: {
        id: movie.id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_date: movie.release_date,
        fantasy_points: movie.fantasy_points,
      },
      target_team: {
        id: target.team_id,
        name: targetTeam?.name ?? 'Unknown Team',
      },
      next_turn: nextTurnAfterPick ? {
        round: nextTurnAfterPick.round,
        pick_number: nextTurnAfterPick.pick_number,
        team_id: nextTurnAfterPick.team_id,
        user_id: nextTurnAfterPick.user_id,
        counterpicks_remaining: nextTurnAfterPick.counterpicks_remaining,
      } : null,
      round_complete: roundComplete,
    }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
