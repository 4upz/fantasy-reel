import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  internalErrorResponse,
} from '../_shared/utils.ts'
import {
  computeBidWindow,
  isBidCancellable,
  cancelClosedMessage,
  CANCEL_IN_PROCESSING_MESSAGE,
} from '../_shared/bid-window.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('cancel-bid')

interface CancelBidRequest {
  bid_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth check using user client
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

    // Service client for database operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { bid_id }: CancelBidRequest = await req.json()

    // Validate bid_id
    if (!bid_id || !isValidUUID(bid_id)) {
      return errorResponse('Valid bid_id is required', 400)
    }

    // Fetch the bid with team ownership info
    const { data: bid, error: bidError } = await serviceClient
      .from('pickup_bids')
      .select('*, teams(participant_id, league_participants(user_id))')
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

    // Can only cancel active bids (not outbid - that means someone else is higher)
    if (bid.status !== 'active') {
      return errorResponse('Can only cancel active bids', 400)
    }

    // Once the counter-bid phase starts a bid is a commitment. Without this, a
    // team could bid early on a movie it never wanted, let a rival raise the
    // price all week, then withdraw on Friday having cost them budget for
    // nothing.
    //
    // The window is anchored to the bid's *own* processing_deadline rather than
    // to get_next_processing_deadline(), so the question asked is "is this bid's
    // cycle past its cutoff" -- which stays true for a bid held into extended
    // time by a rival's counter window, where the global next-deadline has
    // already rolled forward and would read as a fresh open phase.
    //
    // isBidCancellable's deadline check is not redundant with that: it is the
    // only guard when a league has the cutoff disabled (hours = 0).
    const { data: league } = await serviceClient
      .from('leagues')
      .select('new_bid_cutoff_hours')
      .eq('id', bid.league_id)
      .single()

    const bidWindow = computeBidWindow(bid.processing_deadline, league?.new_bid_cutoff_hours)
    if (!isBidCancellable(bid.processing_deadline, bidWindow)) {
      return errorResponse(
        bidWindow.isCounterBidPhase ? cancelClosedMessage(bidWindow) : CANCEL_IN_PROCESSING_MESSAGE,
        400,
      )
    }

    // Cancel the bid
    const { error: updateError } = await serviceClient
      .from('pickup_bids')
      .update({ status: 'cancelled' })
      .eq('id', bid_id)

    if (updateError) {
      console.error('Error cancelling bid:', updateError)
      return errorResponse('Failed to cancel bid', 500)
    }

    // Restore the next highest outbid user to active status
    const { data: nextHighestBid } = await serviceClient
      .from('pickup_bids')
      .select('*')
      .eq('league_id', bid.league_id)
      .eq('tmdb_id', bid.tmdb_id)
      .eq('status', 'outbid')
      .order('amount', { ascending: false })
      .limit(1)
      .single()

    if (nextHighestBid) {
      await serviceClient
        .from('pickup_bids')
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
        const movieTitle = nextHighestBid.movie_data?.title || `Movie #${nextHighestBid.tmdb_id}`
        await serviceClient.from('notifications').insert({
          user_id: restoredUserId,
          league_id: bid.league_id,
          type: 'outbid', // reusing outbid type for "you're now highest"
          title: `You're now the highest bidder on ${movieTitle}`,
          body: `The previous highest bid was cancelled. Your bid of $${nextHighestBid.amount} is now leading.`,
          data: {
            bid_id: nextHighestBid.id,
            tmdb_id: nextHighestBid.tmdb_id,
          },
        })
      }
    }

    return jsonResponse({
      message: 'Bid cancelled successfully',
      restored_bid: nextHighestBid ? { id: nextHighestBid.id, amount: nextHighestBid.amount } : null,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
