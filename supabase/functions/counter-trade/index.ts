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
  sendTradeEmailNotifications,
} from '../_shared/trade-validation.ts'

interface CounterTradeRequest {
  trade_offer_id: string
  counter_offered_items: TradeItems
  counter_requested_items: TradeItems
  message?: string
}

interface CounterTradeResult {
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

    const {
      trade_offer_id,
      counter_offered_items,
      counter_requested_items,
      message,
    }: CounterTradeRequest = await req.json()

    // First fetch the trade to verify authorization (without locking)
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

    // Use the atomic database function with row-level locking
    const { data: rpcResult, error: rpcError } = await serviceClient.rpc('counter_trade', {
      p_trade_id: trade_offer_id,
      p_new_initiator_team_id: counterInitiatorTeamId,
      p_new_recipient_team_id: counterRecipientTeamId,
      p_new_initiator_items: enrichedOfferedItems,
      p_new_recipient_items: enrichedRequestedItems,
      p_message: message?.trim() || null,
    })

    if (rpcError) {
      console.error('Failed to counter trade:', rpcError)
      // Check if it's a movie-already-in-trade error
      if (rpcError.message?.includes('already in a pending trade')) {
        return errorResponse('One or more movies are already involved in another pending trade', 400)
      }
      return errorResponse('Failed to submit counter-offer', 500)
    }

    const result = rpcResult as CounterTradeResult

    if (result.error) {
      return errorResponse(result.error, result.status_code || 400)
    }

    // Fetch the updated trade offer for response and notifications
    const { data: updatedOffer } = await serviceClient
      .from('trade_offers')
      .select()
      .eq('id', trade_offer_id)
      .single()

    if (!updatedOffer) {
      return errorResponse('Failed to fetch updated trade offer', 500)
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

    // Send email notification (non-blocking)
    await sendTradeEmailNotifications(serviceClient, updatedOffer, 'countered', {
      notifyRecipient: true,
      message: message?.trim(),
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
