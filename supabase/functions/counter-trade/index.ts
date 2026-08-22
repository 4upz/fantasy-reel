import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import {
  TradeItems,
  validateTradeProposal,
  enrichTradeItems,
  tradeItemLabel,
  getTeamInfo,
  getTeamName,
  getTradeOffer,
  validateTradeStatus,
  createServiceClient,
  notifyTradeParties,
  sendTradeEmailNotifications,
} from '../_shared/trade-validation.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('counter-trade')

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

    // ROLE SWAP DESIGN DECISION:
    // When a counter-offer is submitted, the initiator and recipient roles are swapped.
    // This means:
    // - The person countering (originally the recipient) becomes the new initiator
    // - The original proposer becomes the new recipient (must respond to the counter)
    // - initiator_team_id always = "who proposed this version of the trade"
    // - recipient_team_id always = "who must respond to this version"
    //
    // This simplifies the "who is waiting for a response" logic: it's always recipient_team_id.
    // See counter_trade() function in the database for detailed rationale.
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
      return errorResponse(validationResult.error ?? 'Counter-offer validation failed', 400, {
        invalid_source_ids: validationResult.invalidSourceIds ?? [],
      })
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
      // The movie-overlap trigger that raised 'already in a pending trade' was
      // dropped in 20260809120000 -- a counter may now name movies that other
      // open offers also name. Nothing left to translate into a 400 here.
      log.error('Failed to counter trade', {
        trade_offer_id,
        error: serializeError(rpcError),
      })
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

    // Notify the other team (original initiator, now recipient of the counter-offer)
    // The recipient_team_id is now the team that needs to respond
    const counterTeamInfo = await getTeamInfo(serviceClient, counterInitiatorTeamId)

    await notifyTradeParties(serviceClient, {
      tradeOffer: updatedOffer,
      notifyRecipient: {
        type: 'trade_countered',
        title: 'Trade Counter-Offer Received',
        bodyFn: () =>
          `${counterTeamInfo?.name ?? 'A team'} has sent a counter-offer. You are now responding to their revised proposal.`,
      },
    })

    // Send email + Discord notifications in parallel
    const counterRecipientName = await getTeamName(serviceClient, counterRecipientTeamId)
    const leagueName = await getLeagueName(serviceClient, originalOffer.league_id)

    const counterMovies = enrichedOfferedItems.movies.map(tradeItemLabel).join(', ')
    const counterRequestedMovies = enrichedRequestedItems.movies.map(tradeItemLabel).join(', ')

    const counterFields = [
      { name: `${counterTeamInfo?.name ?? 'Counterer'} offers`, value: counterMovies || 'Nothing', inline: true },
      { name: `${counterRecipientName} offers`, value: counterRequestedMovies || 'Nothing', inline: true },
    ]
    if (message?.trim()) {
      counterFields.push({ name: 'Message', value: message.trim(), inline: false })
    }

    await Promise.allSettled([
      sendTradeEmailNotifications(serviceClient, updatedOffer, 'countered', {
        notifyRecipient: true,
        message: message?.trim(),
      }),
      sendDiscordNotification(serviceClient, {
        leagueId: originalOffer.league_id,
        category: 'trades',
        embeds: [{
          author: buildEmbedAuthor(leagueName, originalOffer.league_id),
          title: `${counterTeamInfo?.name ?? 'A team'} countered with new terms`,
          color: DISCORD_COLORS.yellow,
          fields: counterFields,
          footer: { text: `Trade #${originalOffer.id.slice(0, 8)}` },
          url: buildLeagueUrl(originalOffer.league_id, '/trading'),
        }],
      }),
    ])

    return jsonResponse({
      message: 'Counter-offer submitted successfully',
      trade_offer: updatedOffer,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
