import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
} from '../_shared/utils.ts'

interface DropMovieRequest {
  pickup_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth check using userClient
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Service client for operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { pickup_id }: DropMovieRequest = await req.json()

    // Validate input
    if (!pickup_id || !isValidUUID(pickup_id)) {
      return errorResponse('Valid pickup_id is required', 400)
    }

    // Fetch the pickup with movie, team, and league info
    const { data: pickup, error: pickupError } = await serviceClient
      .from('pickups')
      .select(`
        *,
        movies(id, title, tmdb_id, release_date),
        teams(
          id,
          participant_id,
          league_participants(user_id, league_id)
        )
      `)
      .eq('id', pickup_id)
      .single()

    if (pickupError || !pickup) {
      return errorResponse('Pickup not found', 404)
    }

    // Check ownership - only the owner can drop their movies
    const teamInfo = pickup.teams as unknown as {
      id: string
      participant_id: string
      league_participants: { user_id: string; league_id: string }
    }
    const pickupUserId = teamInfo?.league_participants?.user_id

    if (pickupUserId !== user.id) {
      return errorResponse('You can only drop your own movies', 403)
    }

    // Check if already dropped
    if (pickup.dropped_at) {
      return errorResponse('Movie has already been dropped', 400)
    }

    // Check if movie is released (can't drop released movies)
    const movie = pickup.movies as unknown as {
      id: string
      title: string
      tmdb_id: number
      release_date: string | null
    }
    if (movie.release_date) {
      const releaseDate = new Date(movie.release_date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      if (releaseDate < today) {
        return errorResponse('Cannot drop a movie that has already been released', 400)
      }
    }

    // Fetch league to check drop_limit
    const leagueId = teamInfo.league_participants.league_id
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('drop_limit')
      .eq('id', leagueId)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    const dropLimit = league.drop_limit ?? 2

    // Check drop limit using the helper function
    const { data: dropCount } = await serviceClient.rpc('get_team_drop_count', {
      p_team_id: pickup.team_id,
    })

    if ((dropCount ?? 0) >= dropLimit) {
      return errorResponse(`You have reached the drop limit of ${dropLimit}`, 400)
    }

    // Mark pickup as dropped
    const droppedAt = new Date().toISOString()
    const { error: updateError } = await serviceClient
      .from('pickups')
      .update({ dropped_at: droppedAt })
      .eq('id', pickup_id)

    if (updateError) {
      console.error('Error updating pickup:', updateError)
      return errorResponse('Failed to drop movie', 500)
    }

    // Record the drop in team_drops table
    const { error: dropRecordError } = await serviceClient
      .from('team_drops')
      .insert({
        team_id: pickup.team_id,
        movie_id: pickup.movie_id,
        pickup_id: pickup_id,
        dropped_at: droppedAt,
      })

    if (dropRecordError) {
      // Log but don't fail - the drop was successful
      console.error('Failed to record drop in team_drops:', dropRecordError)
    }

    // Notify other league members that movie is available
    const { data: leagueParticipants } = await serviceClient
      .from('league_participants')
      .select('user_id')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .neq('user_id', user.id)

    if (leagueParticipants && leagueParticipants.length > 0) {
      const notifications = leagueParticipants.map((participant) => ({
        user_id: participant.user_id,
        league_id: leagueId,
        type: 'pickup_available' as const,
        title: `${movie.title} is now available`,
        body: `A team dropped ${movie.title}. It's now available for pickup.`,
        data: {
          tmdb_id: movie.tmdb_id,
          movie_id: movie.id,
        },
      }))

      const { error: notificationError } = await serviceClient
        .from('notifications')
        .insert(notifications)

      if (notificationError) {
        // Log but don't fail - notifications are non-critical
        console.error('Failed to create notifications:', notificationError)
      }
    }

    return jsonResponse({
      message: 'Movie dropped successfully',
      movie: {
        id: movie.id,
        title: movie.title,
        tmdb_id: movie.tmdb_id,
      },
      drops_used: (dropCount ?? 0) + 1,
      drops_remaining: dropLimit - (dropCount ?? 0) - 1,
    })
  } catch (error) {
    console.error('Error dropping movie:', error)
    return errorResponse('Internal server error', 500)
  }
})
