import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import {
  getTeamInfo,
  getTeamName,
  getTradeOffer,
  validateTradeStatus,
  createServiceClient,
  notifyTradeParties,
} from '../_shared/trade-validation.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('cancel-trade')

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

    const leagueName = await getLeagueName(serviceClient, tradeOffer.league_id)

    await Promise.allSettled([
      notifyTradeParties(serviceClient, {
        tradeOffer,
        notifyRecipient: {
          type: 'trade_cancelled',
          title: 'Trade Cancelled',
          bodyFn: (teamName) => `${teamName} has cancelled their trade proposal`,
        },
      }),
      sendDiscordNotification(serviceClient, {
        leagueId: tradeOffer.league_id,
        category: 'trades',
        embeds: [{
          author: buildEmbedAuthor(leagueName, tradeOffer.league_id),
          title: `Trade cancelled by ${initiatorInfo?.name ?? 'a team'}`,
          color: DISCORD_COLORS.crimson,
          footer: { text: `Trade #${tradeOffer.id.slice(0, 8)}` },
          url: buildLeagueUrl(tradeOffer.league_id, '/trading'),
        }],
      }),
    ])

    return jsonResponse({
      message: 'Trade cancelled successfully',
      trade_offer_id,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
