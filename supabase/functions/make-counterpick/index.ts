import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface MakeCounterpickRequest {
  league_id: string
  movie_id: string
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
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Create user-authenticated client for auth validation
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Validate the user
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Create service role client for atomic operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body
    const { league_id, movie_id }: MakeCounterpickRequest = await req.json()

    // Validate required fields
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!movie_id || !isValidUUID(movie_id)) {
      return errorResponse('Valid movie_id is required', 400)
    }

    // Fetch the league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Validate league status
    const validStatuses = ['counterpicking', 'active']
    if (!validStatuses.includes(league.status)) {
      if (league.status === 'drafting') {
        return errorResponse('Counterpick round has not started yet', 400)
      }
      if (league.status === 'setup') {
        return errorResponse('Draft has not started yet', 400)
      }
      return errorResponse(`Cannot make counterpick: league is in '${league.status}' status`, 400)
    }

    // Get user's participant and team in this league
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

    // Determine the phase
    const phase = league.status === 'counterpicking' ? 'draft' : 'bidding'

    // For counterpicking phase: validate it's the user's turn
    if (league.status === 'counterpicking') {
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
    }

    // For active phase: check bidding counterpick slot limit
    if (league.status === 'active') {
      const biddingSlots = league.bidding_counterpick_slots ?? 0
      if (biddingSlots === 0) {
        return errorResponse('Bidding counterpicks are not enabled for this league', 400)
      }

      // Count team's bidding phase counterpicks
      const { count: biddingCounterpicks, error: countError } = await serviceClient
        .from('counterpicks')
        .select('*', { count: 'exact', head: true })
        .eq('counterpicker_team_id', team.id)
        .eq('phase', 'bidding')

      if (countError) {
        console.error('Error counting bidding counterpicks:', countError)
        return errorResponse('Failed to check counterpick limit', 500)
      }

      if ((biddingCounterpicks ?? 0) >= biddingSlots) {
        return errorResponse('You have used all your bidding counterpick slots', 400)
      }
    }

    // Fetch the draft pick for this movie
    const { data: draftPick, error: draftPickError } = await serviceClient
      .from('draft_picks')
      .select('id, team_id, movie_id, dropped_at, counterpicked_by_team_id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .is('dropped_at', null)
      .single()

    if (draftPickError || !draftPick) {
      return errorResponse('Movie not found in this league draft', 404)
    }

    // Cannot counterpick your own movie
    if (draftPick.team_id === team.id) {
      return errorResponse('Cannot counterpick your own movie', 400)
    }

    // Cannot counterpick already-counterpicked movie
    if (draftPick.counterpicked_by_team_id) {
      return errorResponse('This movie has already been counterpicked', 400)
    }

    // Check if movie is already counterpicked in this league (belt and suspenders)
    const { data: existingCounterpick } = await serviceClient
      .from('counterpicks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .single()

    if (existingCounterpick) {
      return errorResponse('This movie has already been counterpicked', 400)
    }

    // Get the next pick order
    const { count: pickOrderCount, error: pickOrderError } = await serviceClient
      .from('counterpicks')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('phase', phase)

    if (pickOrderError) {
      console.error('Error getting pick order:', pickOrderError)
      return errorResponse('Failed to determine pick order', 500)
    }

    const pickOrder = (pickOrderCount ?? 0) + 1

    // Fetch movie details
    const { data: movie, error: movieError } = await serviceClient
      .from('movies')
      .select('id, title, poster_url, release_date, fantasy_points')
      .eq('id', movie_id)
      .single()

    if (movieError || !movie) {
      return errorResponse('Movie not found', 404)
    }

    // Create the counterpick record
    const { data: counterpick, error: counterpickError } = await serviceClient
      .from('counterpicks')
      .insert({
        league_id,
        counterpicker_team_id: team.id,
        target_team_id: draftPick.team_id,
        movie_id,
        draft_pick_id: draftPick.id,
        pick_order: pickOrder,
        phase,
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

    // Update draft_pick.counterpicked_by_team_id
    const { error: updateError } = await serviceClient
      .from('draft_picks')
      .update({ counterpicked_by_team_id: team.id })
      .eq('id', draftPick.id)

    if (updateError) {
      console.error('Error updating draft pick:', updateError)
      // Continue anyway - counterpick was recorded
    }

    // Check if counterpick round is complete (for draft phase only)
    let roundComplete = false
    let nextTurn: CounterpickTurnInfo | null = null

    if (league.status === 'counterpicking') {
      const { data: nextTurnData } = await serviceClient.rpc('get_next_counterpick_turn', {
        p_league_id: league_id,
      })

      if (!nextTurnData || nextTurnData.length === 0) {
        roundComplete = true

        // Transition league to 'active' status
        const { error: statusError } = await serviceClient
          .from('leagues')
          .update({ status: 'active' })
          .eq('id', league_id)

        if (statusError) {
          console.error('Failed to update league status:', statusError)
          // Continue anyway - counterpick was recorded
        }

        // Initialize team budgets for bidding
        const { error: budgetError } = await serviceClient.rpc('initialize_team_budgets', { p_league_id: league_id })
        if (budgetError) {
          console.error('Failed to initialize team budgets:', budgetError)
          // Log but don't fail
        }

        // Create team_scores for all teams in the league
        const { data: participants } = await serviceClient
          .from('league_participants')
          .select('id')
          .eq('league_id', league_id)

        const participantIds = participants?.map(p => p.id) || []

        const { data: teams } = participantIds.length > 0
          ? await serviceClient
              .from('teams')
              .select('id')
              .in('participant_id', participantIds)
          : { data: [] }

        if (teams && teams.length > 0) {
          const teamScores = teams.map(t => ({
            team_id: t.id,
            total_points: 0,
            draft_points: 0,
            counterpick_points: 0,
            movies_scored: 0,
            movies_pending: 0,
            counterpicks_made: 0,
            counterpicks_scored: 0,
          }))

          const { error: scoresError } = await serviceClient
            .from('team_scores')
            .upsert(teamScores, { onConflict: 'team_id' })

          if (scoresError) {
            console.error('Failed to initialize team scores:', scoresError)
            // Log but don't fail
          }
        }
      } else {
        nextTurn = nextTurnData[0]
      }
    }

    // Get target team name
    const { data: targetTeam } = await serviceClient
      .from('teams')
      .select('name')
      .eq('id', draftPick.team_id)
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
        id: draftPick.team_id,
        name: targetTeam?.name ?? 'Unknown Team',
      },
      next_turn: nextTurn ? {
        round: nextTurn.round,
        pick_number: nextTurn.pick_number,
        team_id: nextTurn.team_id,
        user_id: nextTurn.user_id,
        counterpicks_remaining: nextTurn.counterpicks_remaining,
      } : null,
      round_complete: roundComplete,
    }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
