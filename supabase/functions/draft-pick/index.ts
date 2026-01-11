import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface DraftPickRequest {
  league_id: string
  movie_id: string
}

interface NextPickInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
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
    const { league_id, movie_id }: DraftPickRequest = await req.json()

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
    if (league.status !== 'drafting') {
      if (league.status === 'setup') {
        return errorResponse('Draft has not started yet', 400)
      }
      return errorResponse('Draft has already ended', 400)
    }

    // Get next pick info using the database function
    const { data: nextPickData, error: nextPickError } = await serviceClient
      .rpc('get_next_draft_pick', { p_league_id: league_id })

    if (nextPickError) {
      console.error('Error getting next pick:', nextPickError)
      return errorResponse('Failed to determine next pick', 500)
    }

    if (!nextPickData || nextPickData.length === 0) {
      // No more picks - draft should be complete
      return errorResponse('Draft is complete', 400)
    }

    const nextPick: NextPickInfo = nextPickData[0]

    // Verify it's the user's turn
    if (nextPick.user_id !== user.id) {
      return errorResponse('It is not your turn to pick', 403)
    }

    // Validate movie exists
    const { data: movie, error: movieError } = await serviceClient
      .from('movies')
      .select('*')
      .eq('id', movie_id)
      .single()

    if (movieError || !movie) {
      return errorResponse('Movie not found', 404)
    }

    // Check movie status
    if (movie.status !== 'upcoming') {
      return errorResponse('This movie is not available for drafting', 400)
    }

    // Check if movie already drafted in this league
    const { data: existingPick } = await serviceClient
      .from('draft_picks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
      .single()

    if (existingPick) {
      return errorResponse('This movie has already been drafted', 400)
    }

    // Insert the draft pick
    const { data: pick, error: pickError } = await serviceClient
      .from('draft_picks')
      .insert({
        league_id,
        team_id: nextPick.team_id,
        movie_id,
        round: nextPick.round,
        pick_number: nextPick.pick_number
      })
      .select()
      .single()

    if (pickError) {
      console.error('Error creating draft pick:', pickError)
      if (pickError.code === '23505') {
        // Unique constraint violation - race condition
        return errorResponse('This pick slot was just taken. Please try again.', 409)
      }
      return errorResponse('Failed to record draft pick', 500)
    }

    // Get the next pick (for the response)
    const { data: upcomingPickData } = await serviceClient
      .rpc('get_next_draft_pick', { p_league_id: league_id })

    let upcomingPick: NextPickInfo | null = null
    let draftComplete = false

    if (!upcomingPickData || upcomingPickData.length === 0) {
      draftComplete = true

      // Update league status to 'active'
      await serviceClient
        .from('leagues')
        .update({ status: 'active' })
        .eq('id', league_id)

      // Create team_scores for all teams in the league
      // First, get participant IDs for this league
      const { data: participants } = await serviceClient
        .from('league_participants')
        .select('id')
        .eq('league_id', league_id)

      const participantIds = participants?.map(p => p.id) || []

      const { data: teams } = participantIds.length > 0
        ? await serviceClient
            .from('teams')
            .select('id, participant_id')
            .in('participant_id', participantIds)
        : { data: [] }

      if (teams && teams.length > 0) {
        for (const team of teams) {
          await serviceClient
            .from('team_scores')
            .upsert({
              team_id: team.id,
              total_points: 0,
              movies_scored: 0,
              movies_pending: 0
            }, { onConflict: 'team_id' })
        }
      }
    } else {
      upcomingPick = upcomingPickData[0]
    }

    return jsonResponse({
      pick: {
        id: pick.id,
        league_id: pick.league_id,
        team_id: pick.team_id,
        movie_id: pick.movie_id,
        round: pick.round,
        pick_number: pick.pick_number,
        picked_at: pick.picked_at
      },
      movie: {
        id: movie.id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_date: movie.release_date
      },
      next_pick: upcomingPick ? {
        round: upcomingPick.round,
        pick_number: upcomingPick.pick_number,
        team_id: upcomingPick.team_id,
        user_id: upcomingPick.user_id
      } : null,
      draft_complete: draftComplete
    }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
