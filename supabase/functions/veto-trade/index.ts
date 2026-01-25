import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'
import {
  getTeamInfo,
  createServiceClient,
  TradeNotification,
  sendTradeEmailNotifications,
  TradeOffer,
} from '../_shared/trade-validation.ts'

interface VetoTradeRequest {
  trade_offer_id: string
  reason?: string
}

interface VetoTradeResult {
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

    const { trade_offer_id, reason }: VetoTradeRequest = await req.json()

    if (!trade_offer_id || !isValidUUID(trade_offer_id)) {
      return errorResponse('Valid trade_offer_id is required', 400)
    }

    // Get the trade offer with league info for owner check (without locking)
    const { data: tradeOffer, error: offerError } = await serviceClient
      .from('trade_offers')
      .select('*, leagues(owner_id)')
      .eq('id', trade_offer_id)
      .single()

    if (offerError || !tradeOffer) {
      return errorResponse('Trade offer not found', 404)
    }

    // Verify user is the league owner
    const league = tradeOffer.leagues as unknown as { owner_id: string }
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league commissioner can veto trades', 403)
    }

    // Use the atomic database function with row-level locking
    const { data: rpcResult, error: rpcError } = await serviceClient.rpc('veto_trade', {
      p_trade_id: trade_offer_id,
      p_reason: reason?.trim() || null,
    })

    if (rpcError) {
      console.error('Failed to veto trade:', rpcError)
      return errorResponse('Failed to veto trade', 500)
    }

    const result = rpcResult as VetoTradeResult

    if (result.error) {
      return errorResponse(result.error, result.status_code || 400)
    }

    // Notify both teams
    const initiatorInfo = await getTeamInfo(serviceClient, tradeOffer.initiator_team_id)
    const recipientInfo = await getTeamInfo(serviceClient, tradeOffer.recipient_team_id)

    const notifications: TradeNotification[] = []
    const vetoBody = reason
      ? `The commissioner has vetoed your trade: ${reason}`
      : 'The commissioner has vetoed your trade'
    const vetoBodyInvolving = reason
      ? `The commissioner has vetoed a trade involving your team: ${reason}`
      : 'The commissioner has vetoed a trade involving your team'

    if (initiatorInfo) {
      notifications.push({
        user_id: initiatorInfo.user_id,
        league_id: tradeOffer.league_id,
        type: 'trade_vetoed',
        title: 'Trade Vetoed',
        body: vetoBody,
        data: { trade_offer_id, veto_reason: reason || null },
      })
    }

    if (recipientInfo) {
      notifications.push({
        user_id: recipientInfo.user_id,
        league_id: tradeOffer.league_id,
        type: 'trade_vetoed',
        title: 'Trade Vetoed',
        body: vetoBodyInvolving,
        data: { trade_offer_id, veto_reason: reason || null },
      })
    }

    if (notifications.length > 0) {
      await serviceClient.from('notifications').insert(notifications)
    }

    // Send email notifications to both parties (non-blocking)
    const tradeOfferForEmail: TradeOffer = {
      id: tradeOffer.id,
      league_id: tradeOffer.league_id,
      initiator_team_id: tradeOffer.initiator_team_id,
      recipient_team_id: tradeOffer.recipient_team_id,
      initiator_items: tradeOffer.initiator_items,
      recipient_items: tradeOffer.recipient_items,
      status: 'vetoed',
      proposed_at: tradeOffer.proposed_at,
      responded_at: tradeOffer.responded_at,
      accepted_at: tradeOffer.accepted_at,
      review_ends_at: tradeOffer.review_ends_at,
      initiator_message: tradeOffer.initiator_message,
      response_message: tradeOffer.response_message,
      veto_reason: reason?.trim() || null,
    }
    await sendTradeEmailNotifications(serviceClient, tradeOfferForEmail, 'vetoed', {
      notifyInitiator: true,
      notifyRecipient: true,
      vetoReason: reason?.trim(),
    })

    return jsonResponse({
      message: 'Trade vetoed successfully',
      trade_offer_id,
    })
  } catch (error) {
    console.error('Error vetoing trade:', error)
    return errorResponse('Internal server error', 500)
  }
})
