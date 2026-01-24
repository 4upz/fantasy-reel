import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'
import {
  TradeItems,
  validateTradeProposal,
  enrichTradeItems,
  getTeamInfo,
  getTradeOffer,
  validateTradeStatus,
  createServiceClient,
  notifyTradeParties,
} from '../_shared/trade-validation.ts'

interface CounterTradeRequest {
  trade_offer_id: string
  counter_offered_items: TradeItems
  counter_requested_items: TradeItems
  message?: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const {
      trade_offer_id,
      counter_offered_items,
      counter_requested_items,
      message,
    }: CounterTradeRequest = await req.json()

    const tradeResult = await getTradeOffer(serviceClient, trade_offer_id)
    if (tradeResult.error) return tradeResult.error

    const originalOffer = tradeResult.offer

    // Verify user owns the recipient team
    const recipientInfo = await getTeamInfo(serviceClient, originalOffer.recipient_team_id)
    if (!recipientInfo || recipientInfo.user_id !== user.id) {
      return errorResponse('You can only counter trades sent to your team', 403)
    }

    const statusError = validateTradeStatus(originalOffer, ['proposed', 'countered'], 'counter')
    if (statusError) return statusError

    // For counter-offer, roles are swapped
    const counterInitiatorTeamId = originalOffer.recipient_team_id
    const counterRecipientTeamId = originalOffer.initiator_team_id

    const validationResult = await validateTradeProposal(
      serviceClient,
      originalOffer.league_id,
      counterInitiatorTeamId,
      counterRecipientTeamId,
      counter_offered_items,
      counter_requested_items
    )

    if (!validationResult.valid) {
      return errorResponse(validationResult.error ?? 'Counter-offer validation failed', 400)
    }

    const enrichedOfferedItems = await enrichTradeItems(serviceClient, counter_offered_items)
    const enrichedRequestedItems = await enrichTradeItems(serviceClient, counter_requested_items)

    const now = new Date().toISOString()

    const { data: updatedOffer, error: updateError } = await serviceClient
      .from('trade_offers')
      .update({
        status: 'countered',
        initiator_team_id: counterInitiatorTeamId,
        recipient_team_id: counterRecipientTeamId,
        initiator_items: enrichedOfferedItems,
        recipient_items: enrichedRequestedItems,
        responded_at: now,
        accepted_at: null,
        review_ends_at: null,
        response_message: message?.trim() || null,
      })
      .eq('id', trade_offer_id)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to counter trade:', updateError)
      return errorResponse('Failed to submit counter-offer', 500)
    }

    // Notify the other team (original initiator, now recipient)
    const counterTeamInfo = await getTeamInfo(serviceClient, counterInitiatorTeamId)

    await notifyTradeParties(serviceClient, {
      tradeOffer: updatedOffer,
      notifyRecipient: {
        type: 'trade_countered',
        title: 'Trade Counter-Offer',
        bodyFn: () =>
          `${counterTeamInfo?.name ?? 'A team'} has sent a counter-offer to your trade proposal`,
      },
    })

    return jsonResponse({
      message: 'Counter-offer submitted successfully',
      trade_offer: updatedOffer,
    })
  } catch (error) {
    console.error('Error countering trade:', error)
    return errorResponse('Internal server error', 500)
  }
})
