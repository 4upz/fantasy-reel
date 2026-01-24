import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'
import {
  getTeamInfo,
  getTradeOffer,
  validateTradeStatus,
  createServiceClient,
  notifyTradeParties,
} from '../_shared/trade-validation.ts'

interface CancelTradeRequest {
  trade_offer_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const { trade_offer_id }: CancelTradeRequest = await req.json()

    const tradeResult = await getTradeOffer(serviceClient, trade_offer_id)
    if (tradeResult.error) return tradeResult.error

    const tradeOffer = tradeResult.offer

    // Verify user owns the initiator team
    const initiatorInfo = await getTeamInfo(serviceClient, tradeOffer.initiator_team_id)
    if (!initiatorInfo || initiatorInfo.user_id !== user.id) {
      return errorResponse('You can only cancel trades you initiated', 403)
    }

    const statusError = validateTradeStatus(tradeOffer, ['proposed', 'countered'], 'cancel')
    if (statusError) return statusError

    const { error: updateError } = await serviceClient
      .from('trade_offers')
      .update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
      })
      .eq('id', trade_offer_id)

    if (updateError) {
      console.error('Failed to cancel trade:', updateError)
      return errorResponse('Failed to cancel trade', 500)
    }

    await notifyTradeParties(serviceClient, {
      tradeOffer,
      notifyRecipient: {
        type: 'trade_cancelled',
        title: 'Trade Cancelled',
        bodyFn: (teamName) => `${teamName} has cancelled their trade proposal`,
      },
    })

    return jsonResponse({
      message: 'Trade cancelled successfully',
      trade_offer_id,
    })
  } catch (error) {
    console.error('Error cancelling trade:', error)
    return errorResponse('Internal server error', 500)
  }
})
