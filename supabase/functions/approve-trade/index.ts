/**
 * approve-trade -- commissioner counterpart to veto-trade.
 *
 * A trade both teams agreed to sits in 'review' until review_ends_at (default
 * 24h) and is only then executed by the process-trades cron. The commissioner
 * could veto it, but had no way to say "I've reviewed this, let it through" --
 * their only alternative was to wait out the clock. This executes it now.
 */

import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import {
  validateTradeProposal,
  createServiceClient,
  TradeOffer,
} from '../_shared/trade-validation.ts'
import {
  notifyTradeCompleted,
  notifyTradesInvalidated,
  type ExecuteTradeResult,
} from '../_shared/trade-completion.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('approve-trade')

interface ApproveTradeRequest {
  trade_offer_id: string
}

/** approve_trade returns execute_trade's payload, or {error, status_code}. */
interface ApproveTradeResult extends ExecuteTradeResult {
  status_code?: number
}

/** Statuses approve_trade will act on -- both teams have already agreed. */
const APPROVABLE_STATUSES = ['review', 'accepted']

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const { trade_offer_id }: ApproveTradeRequest = await req.json()

    if (!trade_offer_id || !isValidUUID(trade_offer_id)) {
      return errorResponse('Valid trade_offer_id is required', 400)
    }

    // Fetch with league info for the owner check (without locking) -- same
    // shape as veto-trade.
    const { data: tradeOffer, error: offerError } = await serviceClient
      .from('trade_offers')
      .select('*, leagues(owner_id)')
      .eq('id', trade_offer_id)
      .single()

    if (offerError || !tradeOffer) {
      return errorResponse('Trade offer not found', 404)
    }

    const { leagues, ...offer } = tradeOffer
    const league = leagues as unknown as { owner_id: string }
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league commissioner can approve trades', 403)
    }

    if (!APPROVABLE_STATUSES.includes(offer.status)) {
      return errorResponse(
        `Cannot approve a trade with status "${offer.status}". Only a trade both teams have agreed to can be approved.`,
        400
      )
    }

    // Pre-check with the same validation process-trades runs, so a trade that
    // can no longer happen gives the commissioner a reason instead of a bare
    // conflict from execute_trade. The authoritative re-check still happens
    // inside execute_trade under the row lock.
    const validationResult = await validateTradeProposal(
      serviceClient,
      offer.league_id,
      offer.initiator_team_id,
      offer.recipient_team_id,
      offer.initiator_items,
      offer.recipient_items
    )

    if (!validationResult.valid) {
      // Left in review rather than expired here: process-trades expires it with
      // the same reason and notifies both teams when the window closes, and
      // that is not the commissioner's decision to make by clicking approve.
      return errorResponse(
        `This trade can no longer be executed: ${validationResult.error}`,
        409
      )
    }

    const { data: rpcResult, error: rpcError } = await serviceClient.rpc('approve_trade', {
      p_trade_id: trade_offer_id,
      p_approved_by: user.id,
    })

    if (rpcError) {
      log.error('Failed to approve trade', {
        trade_offer_id,
        error: serializeError(rpcError),
      })
      return errorResponse('Failed to approve trade', 500)
    }

    const result = rpcResult as ApproveTradeResult | null

    if (!result?.success) {
      const reason = result?.error ?? 'approve_trade returned no result'
      log.warn('Trade approval refused', { trade_offer_id, reason })
      return errorResponse(reason, result?.status_code ?? 409)
    }

    // The trade has executed. Notify exactly as process-trades does, flagging
    // that it ended early so the teams know why the review period was cut short.
    // (notifyTradeCompleted stamps the 'completed' status on the copy it sends.)
    await notifyTradeCompleted(serviceClient, offer as TradeOffer, { approvedEarly: true })

    const invalidated = result.invalidated_trades ?? []
    if (invalidated.length > 0) {
      await notifyTradesInvalidated(serviceClient, invalidated)
    }

    return jsonResponse({
      message: 'Trade approved and processed',
      trade_offer_id,
      invalidated_trades: invalidated.length,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
