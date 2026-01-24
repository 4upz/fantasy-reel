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
} from '../_shared/trade-validation.ts'

interface VetoTradeRequest {
  trade_offer_id: string
  reason?: string
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

    // Get the trade offer with league info for owner check
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

    if (tradeOffer.status !== 'review') {
      return errorResponse(
        `Cannot veto a trade with status "${tradeOffer.status}". Trades can only be vetoed during the review period.`,
        400
      )
    }

    const { error: updateError } = await serviceClient
      .from('trade_offers')
      .update({
        status: 'vetoed',
        veto_reason: reason?.trim() || null,
      })
      .eq('id', trade_offer_id)

    if (updateError) {
      console.error('Failed to veto trade:', updateError)
      return errorResponse('Failed to veto trade', 500)
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

    return jsonResponse({
      message: 'Trade vetoed successfully',
      trade_offer_id,
    })
  } catch (error) {
    console.error('Error vetoing trade:', error)
    return errorResponse('Internal server error', 500)
  }
})
