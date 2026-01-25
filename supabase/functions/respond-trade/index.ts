import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'
import {
  validateTradeProposal,
  getTeamInfo,
  getTradeOffer,
  createServiceClient,
  notifyTradeParties,
  sendTradeEmailNotifications,
} from '../_shared/trade-validation.ts'

interface RespondTradeRequest {
  trade_offer_id: string
  response: 'accept' | 'reject'
  message?: string
}

interface RespondToTradeResult {
  success?: boolean
  error?: string
  status_code?: number
  status?: string
  review_ends_at?: string | null
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const { trade_offer_id, response, message }: RespondTradeRequest = await req.json()

    if (!response || !['accept', 'reject'].includes(response)) {
      return errorResponse('Response must be "accept" or "reject"', 400)
    }

    // First fetch the trade to verify authorization (without locking)
    const tradeResult = await getTradeOffer(serviceClient, trade_offer_id)
    if (tradeResult.error) return tradeResult.error

    const tradeOffer = tradeResult.offer

    // Verify user owns the recipient team
    const recipientInfo = await getTeamInfo(serviceClient, tradeOffer.recipient_team_id)
    if (!recipientInfo || recipientInfo.user_id !== user.id) {
      return errorResponse('You can only respond to trades sent to your team', 403)
    }

    // For accept, re-validate trade items before the atomic operation
    if (response === 'accept') {
      const validationResult = await validateTradeProposal(
        serviceClient,
        tradeOffer.league_id,
        tradeOffer.initiator_team_id,
        tradeOffer.recipient_team_id,
        tradeOffer.initiator_items,
        tradeOffer.recipient_items
      )

      if (!validationResult.valid) {
        return errorResponse(
          `Trade can no longer be accepted: ${validationResult.error}`,
          400
        )
      }
    }

    // Use the atomic database function with row-level locking
    const { data: rpcResult, error: rpcError } = await serviceClient.rpc('respond_to_trade', {
      p_trade_id: trade_offer_id,
      p_response: response,
      p_message: message?.trim() || null,
    })

    if (rpcError) {
      console.error('Failed to respond to trade:', rpcError)
      return errorResponse('Failed to respond to trade', 500)
    }

    const result = rpcResult as RespondToTradeResult

    if (result.error) {
      return errorResponse(result.error, result.status_code || 400)
    }

    // Get league config for notification messages
    const { data: league } = await serviceClient
      .from('leagues')
      .select('trade_veto_hours, trade_review_enabled')
      .eq('id', tradeOffer.league_id)
      .single()

    const vetoHours = league?.trade_veto_hours ?? 24
    const reviewEnabled = league?.trade_review_enabled ?? true

    if (response === 'reject') {
      await notifyTradeParties(serviceClient, {
        tradeOffer,
        notifyInitiator: {
          type: 'trade_rejected',
          title: 'Trade Rejected',
          bodyFn: (teamName) => `${teamName} has rejected your trade proposal`,
        },
      })

      // Send email notification (non-blocking)
      await sendTradeEmailNotifications(serviceClient, tradeOffer, 'rejected', {
        notifyInitiator: true,
        message: message?.trim(),
      })

      return jsonResponse({ message: 'Trade rejected', trade_offer_id })
    }

    // Fetch the updated trade offer for response
    const { data: updatedOffer } = await serviceClient
      .from('trade_offers')
      .select()
      .eq('id', trade_offer_id)
      .single()

    await notifyTradeParties(serviceClient, {
      tradeOffer,
      notifyInitiator: {
        type: 'trade_accepted',
        title: 'Trade Accepted',
        bodyFn: (teamName) =>
          reviewEnabled
            ? `${teamName} accepted your trade. It's now in review for ${vetoHours} hours.`
            : `${teamName} accepted your trade. It will be processed shortly.`,
        data: { review_ends_at: result.review_ends_at },
      },
    })

    // Send email notification with updated trade offer data
    const tradeOfferWithReview = { ...tradeOffer, review_ends_at: result.review_ends_at ?? null }
    await sendTradeEmailNotifications(serviceClient, tradeOfferWithReview, 'accepted', {
      notifyInitiator: true,
      message: message?.trim(),
    })

    return jsonResponse({
      message: reviewEnabled
        ? `Trade accepted and is now in review for ${vetoHours} hours`
        : 'Trade accepted',
      trade_offer: updatedOffer,
    })
  } catch (error) {
    console.error('Error responding to trade:', error)
    return errorResponse('Internal server error', 500)
  }
})
