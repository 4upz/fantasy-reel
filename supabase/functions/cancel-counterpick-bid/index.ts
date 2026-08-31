/**
 * Cancel Counterpick Bid Edge Function
 *
 * Allows a team to cancel their active counterpick bid.
 * If cancelled, the next highest outbid bid is restored to active.
 * Mirrors cancel-bid but operates on counterpick_bids table.
 *
 * Request: { bid_id: string }
 * Response: { message: string, restored_bid?: { id: string, amount: number } }
 */

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
import {
  computeBidWindow,
  isBidCancellable,
  cancelClosedMessage,
  CANCEL_IN_PROCESSING_MESSAGE,
} from '../_shared/bid-window.ts'
import { createLogger } from '../_shared/logger.ts'
import { assertLeagueWritable } from '../_shared/league-status.ts'

const log = createLogger('cancel-counterpick-bid')

interface CancelCounterpickBidRequest {
  bid_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    const serviceClient = createServiceClient()

    const { bid_id }: CancelCounterpickBidRequest = await req.json()

    // Validate bid_id
    if (!bid_id || !isValidUUID(bid_id)) {
      return errorResponse('Valid bid_id is required', 400)
    }

    // Fetch the bid with team ownership info
    const { data: bid, error: bidError } = await serviceClient
      .from('counterpick_bids')
      .select('*, teams!counterpick_bids_team_id_fkey(participant_id, league_participants(user_id))')
      .eq('id', bid_id)
      .single()

    if (bidError || !bid) {
      return errorResponse('Bid not found', 404)
    }

    // Check ownership - only the bid owner can cancel
    const bidUserId = (bid.teams as unknown as {
      league_participants: { user_id: string }
    })?.league_participants?.user_id

    if (bidUserId !== user.id) {
      return errorResponse('You can only cancel your own bids', 403)
    }

    // Can only cancel active bids
    if (bid.status !== 'active') {
      return errorResponse('Can only cancel active bids', 400)
    }

    // Same commitment rule as cancel-bid, anchored to this bid's own cycle --
    // see the comment there for why the deadline check is not redundant with
    // the phase check.
    const { data: league } = await serviceClient
      .from('leagues')
      .select('status, new_bid_cutoff_hours')
      .eq('id', bid.league_id)
      .single()

    // See cancel-bid: a finished season answers before the cancel window does.
    const writable = assertLeagueWritable(league)
    if (!writable.ok) return writable.response

    const bidWindow = computeBidWindow(bid.processing_deadline, league?.new_bid_cutoff_hours)
    if (!isBidCancellable(bid.processing_deadline, bidWindow)) {
      return errorResponse(
        bidWindow.isCounterBidPhase ? cancelClosedMessage(bidWindow) : CANCEL_IN_PROCESSING_MESSAGE,
        400,
      )
    }

    // Cancel the bid
    const { error: updateError } = await serviceClient
      .from('counterpick_bids')
      .update({ status: 'cancelled' })
      .eq('id', bid_id)

    if (updateError) {
      console.error('Error cancelling counterpick bid:', updateError)
      return errorResponse('Failed to cancel bid', 500)
    }

    // Restore the next highest outbid user to active status
    const { data: nextHighestBid } = await serviceClient
      .from('counterpick_bids')
      .select('*')
      .eq('league_id', bid.league_id)
      .eq('movie_id', bid.movie_id)
      .eq('status', 'outbid')
      .order('amount', { ascending: false })
      .limit(1)
      .single()

    if (nextHighestBid) {
      await serviceClient
        .from('counterpick_bids')
        .update({
          status: 'active',
          countered_at: null,
          response_deadline: null,
        })
        .eq('id', nextHighestBid.id)

      // Notify the restored bidder
      const { data: restoredTeam } = await serviceClient
        .from('teams')
        .select('league_participants(user_id)')
        .eq('id', nextHighestBid.team_id)
        .single()

      const restoredUserId = (restoredTeam?.league_participants as unknown as { user_id: string })?.user_id
      if (restoredUserId) {
        // Get movie title from movies table
        const { data: movie } = await serviceClient
          .from('movies')
          .select('title')
          .eq('id', bid.movie_id)
          .single()
        const movieTitle = movie?.title || 'Unknown Movie'

        await serviceClient.from('notifications').insert({
          user_id: restoredUserId,
          league_id: bid.league_id,
          type: 'outbid',
          title: `You're now the highest counterpick bidder on ${movieTitle}`,
          body: `The previous highest bid was cancelled. Your bid of $${nextHighestBid.amount} is now leading.`,
          data: {
            bid_id: nextHighestBid.id,
            movie_id: bid.movie_id,
            bid_type: 'counterpick',
          },
        })
      }
    }

    return jsonResponse({
      message: 'Counterpick bid cancelled successfully',
      restored_bid: nextHighestBid ? { id: nextHighestBid.id, amount: nextHighestBid.amount } : null,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
