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
  getTeamInfo,
  getTeamName,
  createServiceClient,
  TradeNotification,
  sendTradeEmailNotifications,
  TradeOffer,
} from '../_shared/trade-validation.ts'
import { assertLeagueWritable } from '../_shared/league-status.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('veto-trade')

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
      .select('*, leagues(owner_id, status)')
      .eq('id', trade_offer_id)
      .single()

    if (offerError || !tradeOffer) {
      return errorResponse('Trade offer not found', 404)
    }

    // Verify user is the league owner
    const league = tradeOffer.leagues as unknown as { owner_id: string; status: string }
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league commissioner can veto trades', 403)
    }

    // approve-trade and veto-trade do not go through getTradeOffer (they need
    // the commissioner check on the same row), so the completed-season guard is
    // applied here instead -- see the note in _shared/trade-validation.ts.
    const writable = assertLeagueWritable(league)
    if (!writable.ok) return writable.response

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
      ...tradeOffer,
      status: 'vetoed',
      veto_reason: reason?.trim() || null,
    }
    const [initiatorTeamName, recipientTeamName, leagueName] = await Promise.all([
      getTeamName(serviceClient, tradeOffer.initiator_team_id),
      getTeamName(serviceClient, tradeOffer.recipient_team_id),
      getLeagueName(serviceClient, tradeOffer.league_id),
    ])

    const vetoFields = reason?.trim()
      ? [{ name: 'Reason', value: reason.trim(), inline: false }]
      : undefined

    await Promise.allSettled([
      sendTradeEmailNotifications(serviceClient, tradeOfferForEmail, 'vetoed', {
        notifyInitiator: true,
        notifyRecipient: true,
        vetoReason: reason?.trim(),
      }),
      sendDiscordNotification(serviceClient, {
        leagueId: tradeOffer.league_id,
        category: 'trades',
        embeds: [{
          author: buildEmbedAuthor(leagueName, tradeOffer.league_id),
          title: `Commissioner vetoed trade between ${initiatorTeamName} and ${recipientTeamName}`,
          color: DISCORD_COLORS.crimson,
          fields: vetoFields,
          footer: { text: `Trade #${tradeOffer.id.slice(0, 8)}` },
          url: buildLeagueUrl(tradeOffer.league_id, '/trading'),
        }],
      }),
    ])

    return jsonResponse({
      message: 'Trade vetoed successfully',
      trade_offer_id,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
