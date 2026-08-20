/**
 * Set Counterpick Bid Priorities Edge Function
 *
 * Reorders a team's pending counterpick bids. Priority decides which counterpicks
 * the team keeps when more of its bids win than it has
 * `leagues.bidding_counterpick_slots` for -- see process-bids and
 * _shared/bid-resolution.ts (issue #24).
 *
 * Request:  { league_id: string, bid_ids: string[] }  // most wanted first
 * Response: { bids: CounterpickBid[], message: string }
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
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('set-counterpick-bid-priorities')

interface SetCounterpickBidPrioritiesRequest {
  league_id: string
  bid_ids: string[]
}

/** Statuses a bid can hold while it is still awaiting processing. */
const PENDING_STATUSES = ['active', 'outbid']

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    const serviceClient = createServiceClient()

    const { league_id, bid_ids }: SetCounterpickBidPrioritiesRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!Array.isArray(bid_ids) || bid_ids.length === 0) {
      return errorResponse('bid_ids must be a non-empty array', 400)
    }

    if (!bid_ids.every((id) => typeof id === 'string' && isValidUUID(id))) {
      return errorResponse('bid_ids must all be valid UUIDs', 400)
    }

    if (new Set(bid_ids).size !== bid_ids.length) {
      return errorResponse('bid_ids must not contain duplicates', 400)
    }

    // Resolve the caller's team in this league
    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !participant) {
      return errorResponse('You are not a member of this league', 403)
    }

    const team = participant.teams as unknown as { id: string }
    if (!team) {
      return errorResponse('Team not found', 404)
    }

    const loadPendingBids = () =>
      serviceClient
        .from('counterpick_bids')
        .select('*')
        .eq('league_id', league_id)
        .eq('team_id', team.id)
        .in('status', PENDING_STATUSES)
        .order('priority', { ascending: true })

    const { data: pendingBids, error: bidsError } = await loadPendingBids()

    if (bidsError) {
      console.error('Error loading counterpick bids:', bidsError)
      return errorResponse('Failed to load bids', 500)
    }

    if (!pendingBids || pendingBids.length === 0) {
      return errorResponse('You have no pending counterpick bids to reorder', 400)
    }

    // Require the full set. A partial list would leave the omitted bids at stale
    // numbers, and the caller could not tell where they had landed.
    const pendingIds = new Set(pendingBids.map((bid) => bid.id))
    if (bid_ids.some((id) => !pendingIds.has(id))) {
      return errorResponse(
        'bid_ids may only contain your own pending counterpick bids in this league',
        400,
      )
    }

    if (bid_ids.length !== pendingBids.length) {
      return errorResponse(
        `bid_ids must list all ${pendingBids.length} of your pending counterpick bids`,
        400,
      )
    }

    // Dense 1..N in the order given.
    await Promise.all(
      bid_ids.map((bidId, index) =>
        serviceClient
          .from('counterpick_bids')
          .update({ priority: index + 1 })
          .eq('id', bidId)
          .eq('team_id', team.id)
      ),
    )

    const { data: updatedBids, error: refetchError } = await loadPendingBids()

    if (refetchError) {
      console.error('Error reloading counterpick bids:', refetchError)
      return errorResponse('Priorities saved but could not be reloaded', 500)
    }

    return jsonResponse({
      bids: updatedBids,
      message: 'Bid priorities updated',
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
