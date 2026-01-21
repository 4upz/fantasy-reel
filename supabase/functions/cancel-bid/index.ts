import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
} from '../_shared/utils.ts'

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

    // Cancel the bid
    const { error: updateError } = await serviceClient
      .from('pickup_bids')
      .update({ status: 'cancelled' })
      .eq('id', bid_id)

    if (updateError) {
      console.error('Error cancelling bid:', updateError)
      return errorResponse('Failed to cancel bid', 500)
    }

    return jsonResponse({ message: 'Bid cancelled successfully' })
  } catch (error) {
    console.error('Error cancelling bid:', error)
    return errorResponse('Internal server error', 500)
  }
})
