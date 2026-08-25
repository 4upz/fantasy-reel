import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  internalErrorResponse,
  isUpcomingMovie,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('drop-movie')

interface DropMovieRequest {
  pickup_id?: string
  draft_pick_id?: string
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

    const { pickup_id, draft_pick_id }: DropMovieRequest = await req.json()

    // Validate input: exactly one of pickup_id or draft_pick_id must be provided
    const hasPickupId = pickup_id && isValidUUID(pickup_id)
    const hasDraftPickId = draft_pick_id && isValidUUID(draft_pick_id)

    if (!hasPickupId && !hasDraftPickId) {
      return errorResponse('Valid pickup_id or draft_pick_id is required', 400)
    }

    if (hasPickupId && hasDraftPickId) {
      return errorResponse('Provide only one of pickup_id or draft_pick_id', 400)
    }

    // Common variables
    let teamId: string
    let movieId: string
    let leagueId: string
    let counterpickedByTeamId: string | null
    let movie: { id: string; title: string; tmdb_id: number; release_date: string | null }

    if (hasPickupId) {
      // ========== PICKUP DROP FLOW ==========
      // Note: Must specify !pickups_team_id_fkey because pickups has two FKs to
      // teams: team_id (the owner) and counterpicked_by_team_id (the counterpicker)
      const { data: pickup, error: pickupError } = await serviceClient
        .from('pickups')
        .select(`
          *,
          movies(id, title, tmdb_id, release_date),
          teams!pickups_team_id_fkey(
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

      const teamInfo = pickup.teams as unknown as {
        id: string
        participant_id: string
        league_participants: { user_id: string; league_id: string }
      }
      const pickupUserId = teamInfo?.league_participants?.user_id

      if (pickupUserId !== user.id) {
        return errorResponse('You can only drop your own movies', 403)
      }

      if (pickup.dropped_at) {
        return errorResponse('Movie has already been dropped', 400)
      }

      teamId = pickup.team_id
      movieId = pickup.movie_id
      leagueId = teamInfo.league_participants.league_id
      counterpickedByTeamId = pickup.counterpicked_by_team_id
      movie = pickup.movies as unknown as typeof movie
    } else {
      // ========== DRAFT PICK DROP FLOW ==========
      // Note: Must specify !draft_picks_team_id_fkey because draft_picks has two FKs to teams:
      // team_id (the drafter) and counterpicked_by_team_id (the counterpicker)
      const { data: draftPick, error: draftPickError } = await serviceClient
        .from('draft_picks')
        .select(`
          *,
          movies(id, title, tmdb_id, release_date),
          teams!draft_picks_team_id_fkey(
            id,
            participant_id,
            league_participants(user_id, league_id)
          )
        `)
        .eq('id', draft_pick_id)
        .single()

      if (draftPickError || !draftPick) {
        return errorResponse('Draft pick not found', 404)
      }

      const teamInfo = draftPick.teams as unknown as {
        id: string
        participant_id: string
        league_participants: { user_id: string; league_id: string }
      }
      const draftPickUserId = teamInfo?.league_participants?.user_id

      if (draftPickUserId !== user.id) {
        return errorResponse('You can only drop your own movies', 403)
      }

      if (draftPick.dropped_at) {
        return errorResponse('Movie has already been dropped', 400)
      }

      teamId = draftPick.team_id
      movieId = draftPick.movie_id
      leagueId = teamInfo.league_participants.league_id
      counterpickedByTeamId = draftPick.counterpicked_by_team_id
      movie = draftPick.movies as unknown as typeof movie
    }

    // A released movie is droppable. Its score is already banked, so dropping
    // it retires those points -- which is the whole reason a team would spend a
    // drop on one. Counterpick rules below still apply, and are the only thing
    // that locks a movie to a roster.
    //
    // What releasing *does* change is where the movie goes afterwards: only a
    // movie that is still biddable can be picked up by anyone else, so the same
    // guard place-bid uses decides that here rather than a second date compare.
    const isPickupEligible = isUpcomingMovie(movie.release_date).valid

    // Fetch league to check status, drop_limit, and counterpick blocking
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('status, drop_limit, counterpicks_block_drops')
      .eq('id', leagueId)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.status !== 'active') {
      return errorResponse('Drops are only allowed while the league is active', 400)
    }

    if (league.counterpicks_block_drops) {
      // Awarded counterpick: the loaded pickup/draft-pick row already carries
      // counterpicked_by_team_id, so no re-query is needed here.
      if (counterpickedByTeamId) {
        return errorResponse('Cannot drop a movie that has been counterpicked', 400)
      }

      // Pending counterpick bid: an active or outbid budget auction on this movie
      // should also block the drop -- letting it through would strand the bid.
      const { count: pendingBidCount } = await serviceClient
        .from('counterpick_bids')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('movie_id', movieId)
        .in('status', ['active', 'outbid'])

      if ((pendingBidCount ?? 0) > 0) {
        return errorResponse('Cannot drop this movie: another team has a pending counterpick bid on it', 400)
      }
    }

    const dropLimit = league.drop_limit ?? 2

    // Check drop limit using the helper function
    const { data: dropCount } = await serviceClient.rpc('get_team_drop_count', {
      p_team_id: teamId,
    })

    if ((dropCount ?? 0) >= dropLimit) {
      return errorResponse(`You have reached the drop limit of ${dropLimit}`, 400)
    }

    const droppedAtTimestamp = new Date().toISOString()

    if (hasPickupId) {
      // ========== RECORD PICKUP DROP ==========
      const { error: dropRecordError } = await serviceClient
        .from('team_drops')
        .insert({
          team_id: teamId,
          movie_id: movieId,
          pickup_id: pickup_id,
          dropped_at: droppedAtTimestamp,
        })

      if (dropRecordError) {
        console.error('Failed to record drop in team_drops:', dropRecordError)
        const { data: newDropCount } = await serviceClient.rpc('get_team_drop_count', {
          p_team_id: teamId,
        })
        if ((newDropCount ?? 0) >= dropLimit) {
          return errorResponse(`You have reached the drop limit of ${dropLimit}`, 400)
        }
        return errorResponse('Failed to drop movie', 500)
      }

      // Mark pickup as dropped
      const { error: updateError } = await serviceClient
        .from('pickups')
        .update({ dropped_at: droppedAtTimestamp })
        .eq('id', pickup_id)

      if (updateError) {
        console.error('Error updating pickup:', updateError)
        await serviceClient.from('team_drops').delete().eq('pickup_id', pickup_id)
        return errorResponse('Failed to drop movie', 500)
      }
    } else {
      // ========== RECORD DRAFT PICK DROP ==========
      const { error: dropRecordError } = await serviceClient
        .from('team_drops')
        .insert({
          team_id: teamId,
          movie_id: movieId,
          draft_pick_id: draft_pick_id,
          dropped_at: droppedAtTimestamp,
        })

      if (dropRecordError) {
        console.error('Failed to record drop in team_drops:', dropRecordError)
        const { data: newDropCount } = await serviceClient.rpc('get_team_drop_count', {
          p_team_id: teamId,
        })
        if ((newDropCount ?? 0) >= dropLimit) {
          return errorResponse(`You have reached the drop limit of ${dropLimit}`, 400)
        }
        return errorResponse('Failed to drop movie', 500)
      }

      // Mark draft pick as dropped
      const { error: updateError } = await serviceClient
        .from('draft_picks')
        .update({ dropped_at: droppedAtTimestamp })
        .eq('id', draft_pick_id)

      if (updateError) {
        console.error('Error updating draft pick:', updateError)
        await serviceClient.from('team_drops').delete().eq('draft_pick_id', draft_pick_id)
        return errorResponse('Failed to drop movie', 500)
      }
    }

    // Notify other league members that the movie is available -- but only when
    // it actually is. place-bid refuses a movie that has already opened, so
    // announcing a released drop as available for pickup would send the whole
    // league after something none of them can bid on.
    if (isPickupEligible) {
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
          console.error('Failed to create notifications:', notificationError)
        }
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
      /** False once the movie has opened: nobody can bid a released movie back. */
      available_for_pickup: isPickupEligible,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
