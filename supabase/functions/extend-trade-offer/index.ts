/**
 * extend-trade-offer -- the proposer gives the recipient more time.
 *
 * Phase 2 of docs/PLAN-trade-offer-expiry.md. The alternative to this function
 * is cancel-and-repropose, which destroys the thread, re-notifies everyone and
 * re-enters the contested pool for a change the proposer meant as "take your
 * time".
 *
 * Proposer only, and forward only. Both halves of that matter: the recipient
 * must not be able to move a clock they are being measured against, and nobody
 * may pull one in while the other side is mid-decision.
 */

import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import {
  getTradeOffer,
  getTeamInfo,
  getLeagueTradeConfig,
  validateTradeStatus,
  validateLeagueTradingEnabled,
  createServiceClient,
} from '../_shared/trade-validation.ts'
import { resolveOfferExpiry, deriveExpiryBounds, hasLapsed } from '../_shared/trade-expiry.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('extend-trade-offer')

interface ExtendTradeOfferRequest {
  trade_offer_id: string
  /** ISO-8601 instant the offer should stand until. */
  expires_at: string
}

interface ExtendTradeOfferResult {
  success?: boolean
  error?: string
  status_code?: number
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const { trade_offer_id, expires_at }: ExtendTradeOfferRequest = await req.json()

    const tradeResult = await getTradeOffer(serviceClient, trade_offer_id)
    if (tradeResult.error) return tradeResult.error

    const offer = tradeResult.offer

    // The proposer, not the recipient. initiator_team_id always means "who
    // proposed this version of the trade" -- counter_trade swaps the roles, so
    // after a counter this is the counterer, which is the right answer: they
    // are the one whose offer is on the table.
    const initiatorInfo = await getTeamInfo(serviceClient, offer.initiator_team_id)
    if (!initiatorInfo || initiatorInfo.user_id !== user.id) {
      return errorResponse('Only the team that made this offer can extend it', 403)
    }

    const statusError = validateTradeStatus(offer, ['proposed', 'countered'], 'extend')
    if (statusError) return statusError

    // UX-earlier mirror of the guard inside extend_trade_offer(), kept for the
    // same reason counter-trade keeps its copy: it saves resolving an expiry and
    // a round trip for an offer that is already dead. The other refusals the RPC
    // makes (no clock to extend, forward-only) are NOT mirrored -- their wording
    // is forwarded verbatim from the RPC below, and a second copy on this side
    // of the boundary would only drift.
    if (hasLapsed(offer.expires_at)) {
      return errorResponse('This offer has expired', 400)
    }

    if (!offer.expires_at) {
      return errorResponse(
        'This offer has no expiry to extend -- it stands until it is answered',
        400
      )
    }

    if (!expires_at) {
      return errorResponse('A new expiry is required', 400)
    }

    // Same resolver as propose and counter, so the minimum, the maximum and the
    // league-deadline clamp cannot drift between the three write paths. The
    // anchor is 'fixed' by construction: an extension outlives whatever release
    // the offer was waiting on, so a movie_release offer becomes a fixed one
    // here and the RPC clears the anchor movie to match.
    const config = await getLeagueTradeConfig(serviceClient, offer.league_id)
    if (!config) {
      return errorResponse('League not found', 404)
    }

    // The same gate every other trade write path runs. Without it a
    // commissioner could switch trading off and a proposer could still push an
    // open offer's clock out -- respond_to_trade would refuse the acceptance,
    // so nothing incoherent could be executed, but the offer would go on
    // advertising a future in a league that had closed trading.
    const tradingEnabled = validateLeagueTradingEnabled(config, config.status)
    if (!tradingEnabled.valid) {
      return errorResponse(tradingEnabled.error ?? 'Trading is not available', 400)
    }

    const expiry = await resolveOfferExpiry(
      serviceClient,
      { expires_at, expiry_anchor: 'fixed' },
      {
        tradeDeadline: config.trade_deadline,
        bounds: deriveExpiryBounds(config),
        // The league minimum does not gate an extension -- see the comment on
        // `earliest` in the resolver. Forward-only already guarantees an
        // extension can only lengthen the window.
        enforceMinimum: false,
        initiatorItems: offer.initiator_items,
        recipientItems: offer.recipient_items,
      }
    )

    if (!expiry.valid) {
      return errorResponse(expiry.error, 400)
    }

    // resolveOfferExpiry clamps to the league's season deadline silently, which
    // is right for a proposal -- the offer simply ends sooner than asked. For an
    // extension the clamp can swallow the whole extension, and the RPC's
    // forward-only refusal would then blame the proposer for a limit they never
    // chose. The resolver reports the clamp rather than this handler inferring
    // it, which would mean re-deriving the resolver's own rounding.
    if (new Date(expiry.expires_at!).getTime() <= new Date(offer.expires_at).getTime()) {
      return errorResponse(
        expiry.clamped
          ? 'This offer already stands until the league trade deadline, so it cannot be extended further'
          : 'An offer can only be extended, never shortened',
        400
      )
    }

    const { data: rpcResult, error: rpcError } = await serviceClient.rpc('extend_trade_offer', {
      p_trade_id: trade_offer_id,
      p_expires_at: expiry.expires_at,
    })

    if (rpcError) {
      log.error('Failed to extend trade offer', {
        trade_offer_id,
        error: serializeError(rpcError),
      })
      return errorResponse('Failed to extend the offer', 500)
    }

    const result = rpcResult as ExtendTradeOfferResult | null

    if (!result?.success) {
      return errorResponse(result?.error ?? 'Failed to extend the offer', result?.status_code ?? 400)
    }

    // Nothing is notified here, deliberately -- do not "fix" this by adding a
    // notifyTradeParties call. An extension only ever moves in the recipient's
    // favour, and their open trading page already shows the new clock through
    // the trade_offers realtime subscription. A recipient who had already been
    // nudged is covered too: extend_trade_offer() clears
    // expiry_reminder_sent_at, so they get a fresh nudge against the new window
    // rather than one message saying "hurry" and another saying "never mind".
    const { data: updatedOffer } = await serviceClient
      .from('trade_offers')
      .select()
      .eq('id', trade_offer_id)
      .single()

    if (!updatedOffer) {
      return errorResponse('Failed to fetch updated trade offer', 500)
    }

    return jsonResponse({
      message: 'Offer extended',
      trade_offer: updatedOffer,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
