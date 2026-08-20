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
  TradeItems,
  validateTradeProposal,
  enrichTradeItems,
  getTeamInfo,
  createServiceClient,
  notifyTradeParties,
  sendTradeEmailNotifications,
  getTradeMentionContent,
} from '../_shared/trade-validation.ts'
import { resolveOfferExpiry, type ExpiryRequest } from '../_shared/trade-expiry.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName, discordTimestamp } from '../_shared/discord.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('propose-trade')

interface ProposeTradeRequest extends ExpiryRequest {
  league_id: string
  recipient_team_id: string
  offered_items: TradeItems
  requested_items: TradeItems
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
      league_id,
      recipient_team_id,
      offered_items,
      requested_items,
      message,
      expires_at,
      expiry_anchor,
    }: ProposeTradeRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!recipient_team_id || !isValidUUID(recipient_team_id)) {
      return errorResponse('Valid recipient_team_id is required', 400)
    }

    // Get initiator's team in this league
    const { data: initiatorParticipant, error: participantError } = await serviceClient
      .from('league_participants')
      .select('id, teams(id)')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !initiatorParticipant) {
      return errorResponse('You are not an active participant in this league', 403)
    }

    const initiatorTeam = initiatorParticipant.teams as unknown as { id: string } | null
    if (!initiatorTeam) {
      return errorResponse('You do not have a team in this league', 403)
    }

    const initiatorTeamId = initiatorTeam.id

    if (initiatorTeamId === recipient_team_id) {
      return errorResponse('Cannot propose a trade with yourself', 400)
    }

    const validationResult = await validateTradeProposal(
      serviceClient,
      league_id,
      initiatorTeamId,
      recipient_team_id,
      offered_items,
      requested_items
    )

    if (!validationResult.valid) {
      return errorResponse(validationResult.error ?? 'Trade validation failed', 400)
    }

    const enrichedOfferedItems = await enrichTradeItems(serviceClient, offered_items)
    const enrichedRequestedItems = await enrichTradeItems(serviceClient, requested_items)

    // The picker enforces the same bounds for a nicer error, but a crafted
    // request skips it entirely -- this is the check that actually holds. A
    // release anchor is resolved here rather than trusted from the client.
    //
    // The league config comes back from the validation above rather than being
    // fetched again: only `trade_deadline` is needed, and validateTradeProposal
    // has already read (and vouched for) that row.
    const expiry = await resolveOfferExpiry(
      serviceClient,
      { expires_at, expiry_anchor },
      {
        tradeDeadline: validationResult.config?.trade_deadline ?? null,
        initiatorItems: enrichedOfferedItems,
        recipientItems: enrichedRequestedItems,
      }
    )

    if (!expiry.valid) {
      return errorResponse(expiry.error, 400)
    }

    const { data: tradeOffer, error: insertError } = await serviceClient
      .from('trade_offers')
      .insert({
        league_id,
        initiator_team_id: initiatorTeamId,
        recipient_team_id,
        initiator_items: enrichedOfferedItems,
        recipient_items: enrichedRequestedItems,
        status: 'proposed',
        proposed_at: new Date().toISOString(),
        initiator_message: message?.trim() || null,
        expires_at: expiry.expires_at,
        expiry_anchor: expiry.expiry_anchor,
      })
      .select()
      .single()

    if (insertError || !tradeOffer) {
      // Competing offers are legal as of 20260809120000: the movie-overlap
      // trigger and the one-open-offer-per-team-pair unique index are both
      // gone, so the two constraint violations this used to translate into 400s
      // can no longer happen. Anything reaching here is a genuine failure.
      log.error('Failed to create trade offer', {
        league_id,
        initiator_team_id: initiatorTeamId,
        recipient_team_id,
        error: serializeError(insertError),
      })
      return errorResponse('Failed to create trade offer', 500)
    }

    const initiatorInfo = await getTeamInfo(serviceClient, initiatorTeamId)

    await notifyTradeParties(serviceClient, {
      tradeOffer,
      notifyRecipient: {
        type: 'trade_proposed',
        title: 'New Trade Proposal',
        bodyFn: () => `${initiatorInfo?.name ?? 'A team'} has proposed a trade with you`,
      },
    })

    // Send email + Discord notifications in parallel
    const recipientInfo = await getTeamInfo(serviceClient, tradeOffer.recipient_team_id)
    const recipientName = recipientInfo?.name ?? 'A team'
    const leagueName = await getLeagueName(serviceClient, league_id)
    const mentionContent = await getTradeMentionContent(serviceClient, [
      initiatorInfo?.user_id,
      recipientInfo?.user_id,
    ])

    const initiatorMovies = enrichedOfferedItems.movies.map(m => m.title ?? 'Unknown').join(', ')
    const recipientMovies = enrichedRequestedItems.movies.map(m => m.title ?? 'Unknown').join(', ')

    const fields = [
      { name: `${initiatorInfo?.name ?? 'Proposer'} offers`, value: initiatorMovies || 'Nothing', inline: true },
      { name: `${recipientName} offers`, value: recipientMovies || 'Nothing', inline: true },
    ]
    if (enrichedOfferedItems.faab > 0 || enrichedRequestedItems.faab > 0) {
      const budgetParts = []
      if (enrichedOfferedItems.faab > 0) budgetParts.push(`${initiatorInfo?.name ?? 'Proposer'}: $${enrichedOfferedItems.faab}`)
      if (enrichedRequestedItems.faab > 0) budgetParts.push(`${recipientName}: $${enrichedRequestedItems.faab}`)
      fields.push({ name: 'Budget', value: budgetParts.join(' / '), inline: true })
    }
    if (expiry.expires_at) {
      fields.push({
        name: 'Expires',
        value: discordTimestamp(expiry.expires_at),
        inline: true,
      })
    }
    if (message?.trim()) {
      fields.push({ name: 'Message', value: message.trim(), inline: false })
    }

    await Promise.allSettled([
      sendTradeEmailNotifications(serviceClient, tradeOffer, 'proposed', {
        notifyRecipient: true,
        message: message?.trim(),
      }),
      sendDiscordNotification(serviceClient, {
        leagueId: league_id,
        category: 'trades',
        content: mentionContent,
        embeds: [{
          author: buildEmbedAuthor(leagueName, league_id),
          title: `${initiatorInfo?.name ?? 'A team'} proposes a trade to ${recipientName}`,
          color: DISCORD_COLORS.gold,
          fields,
          footer: { text: `Trade #${tradeOffer.id.slice(0, 8)}` },
          url: buildLeagueUrl(league_id, '/trading'),
        }],
      }),
    ])

    return jsonResponse(
      {
        message: 'Trade proposal submitted successfully',
        trade_offer: tradeOffer,
      },
      201
    )
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
