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
  validateTradeStatus,
  createServiceClient,
  notifyTradeParties,
  sendTradeEmailNotifications,
} from '../_shared/trade-validation.ts'

interface RespondTradeRequest {
  trade_offer_id: string
  response: 'accept' | 'reject'
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

    const { trade_offer_id, response, message }: RespondTradeRequest = await req.json()

    if (!response || !['accept', 'reject'].includes(response)) {
      return errorResponse('Response must be "accept" or "reject"', 400)
    }

    const tradeResult = await getTradeOffer(serviceClient, trade_offer_id)
    if (tradeResult.error) return tradeResult.error

    const tradeOffer = tradeResult.offer

    // Verify user owns the recipient team
    const recipientInfo = await getTeamInfo(serviceClient, tradeOffer.recipient_team_id)
    if (!recipientInfo || recipientInfo.user_id !== user.id) {
      return errorResponse('You can only respond to trades sent to your team', 403)
    }

    const statusError = validateTradeStatus(tradeOffer, ['proposed', 'countered'], 'respond to')
    if (statusError) return statusError

    const now = new Date().toISOString()

    if (response === 'reject') {
      const { error: updateError } = await serviceClient
        .from('trade_offers')
        .update({
          status: 'rejected',
          responded_at: now,
          response_message: message?.trim() || null,
        })
        .eq('id', trade_offer_id)

      if (updateError) {
        console.error('Failed to reject trade:', updateError)
        return errorResponse('Failed to reject trade', 500)
      }

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

    // Accept the trade - re-validate before accepting
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

    // Get league config for review settings
    const { data: league } = await serviceClient
      .from('leagues')
      .select('trade_veto_hours, trade_review_enabled')
      .eq('id', tradeOffer.league_id)
      .single()

    const vetoHours = league?.trade_veto_hours ?? 24
    const reviewEnabled = league?.trade_review_enabled ?? true

    let newStatus: string
    let reviewEndsAt: string | null = null

    if (reviewEnabled && vetoHours > 0) {
      newStatus = 'review'
      const reviewEnd = new Date()
      reviewEnd.setHours(reviewEnd.getHours() + vetoHours)
      reviewEndsAt = reviewEnd.toISOString()
    } else {
      newStatus = 'accepted'
    }

    const { data: updatedOffer, error: updateError } = await serviceClient
      .from('trade_offers')
      .update({
        status: newStatus,
        responded_at: now,
        accepted_at: now,
        review_ends_at: reviewEndsAt,
        response_message: message?.trim() || null,
      })
      .eq('id', trade_offer_id)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to accept trade:', updateError)
      return errorResponse('Failed to accept trade', 500)
    }

    await notifyTradeParties(serviceClient, {
      tradeOffer,
      notifyInitiator: {
        type: 'trade_accepted',
        title: 'Trade Accepted',
        bodyFn: (teamName) =>
          reviewEnabled
            ? `${teamName} accepted your trade. It's now in review for ${vetoHours} hours.`
            : `${teamName} accepted your trade. It will be processed shortly.`,
        data: { review_ends_at: reviewEndsAt },
      },
    })

    // Send email notification with updated trade offer data
    const tradeOfferWithReview = { ...tradeOffer, review_ends_at: reviewEndsAt }
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
