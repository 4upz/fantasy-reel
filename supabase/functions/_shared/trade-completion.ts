/**
 * Notifications for a trade that has actually executed.
 *
 * Shared by the two callers of execute_trade: the process-trades cron (review
 * window expired, or an accepted trade picked up on the next sweep) and
 * approve-trade (commissioner signed off early). Both produce the same
 * completion traffic -- in-app notification, email, Discord -- and both have to
 * tell the losing side of any competing offer the trade invalidated.
 */

import {
  getTeamInfo,
  getTeamName,
  createServiceClient,
  sendTradeEmailNotifications,
  TradeNotification,
  TradeOffer,
} from './trade-validation.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from './discord.ts'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('trade-completion')

type ServiceClient = ReturnType<typeof createServiceClient>

/** One competing offer that execute_trade expired, as returned in its payload. */
export interface InvalidatedTrade {
  id: string
  league_id: string
  initiator_team_id: string
  recipient_team_id: string
}

/**
 * execute_trade's JSONB return value. Business-rule refusals (not in an
 * executable state, ownership re-validation failure, counterpick self-trade
 * guard) arrive here rather than as a Postgres error, so a null rpc error is
 * NOT on its own proof the trade went through -- always check `success`.
 */
export interface ExecuteTradeResult {
  success?: boolean
  error?: string
  invalidated_trades?: InvalidatedTrade[]
}

interface CompletionOptions {
  /**
   * True when a commissioner approved the trade before its review window
   * expired, which is worth saying out loud: both teams were told to expect a
   * review period, and this is why it ended sooner.
   */
  approvedEarly?: boolean
}

/**
 * Tell both teams their trade is done.
 */
export async function notifyTradeCompleted(
  supabase: ServiceClient,
  trade: TradeOffer,
  options: CompletionOptions = {}
): Promise<void> {
  const { approvedEarly = false } = options

  const [initiatorInfo, recipientInfo, initiatorTeamName, recipientTeamName] = await Promise.all([
    getTeamInfo(supabase, trade.initiator_team_id),
    getTeamInfo(supabase, trade.recipient_team_id),
    getTeamName(supabase, trade.initiator_team_id),
    getTeamName(supabase, trade.recipient_team_id),
  ])

  const bodyFor = (otherTeamName: string) =>
    approvedEarly
      ? `The commissioner approved your trade with ${otherTeamName}. It has been processed.`
      : `Your trade with ${otherTeamName} has been completed`

  const notifications: TradeNotification[] = []

  if (initiatorInfo) {
    notifications.push({
      user_id: initiatorInfo.user_id,
      league_id: trade.league_id,
      type: 'trade_completed',
      title: 'Trade Completed',
      body: bodyFor(recipientTeamName),
      data: { trade_offer_id: trade.id, approved_early: approvedEarly },
    })
  }

  if (recipientInfo) {
    notifications.push({
      user_id: recipientInfo.user_id,
      league_id: trade.league_id,
      type: 'trade_completed',
      title: 'Trade Completed',
      body: bodyFor(initiatorTeamName),
      data: { trade_offer_id: trade.id, approved_early: approvedEarly },
    })
  }

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications)
  }

  // Send email + Discord notifications in parallel
  const tradeOffer: TradeOffer = { ...trade, status: 'completed' }
  const leagueName = await getLeagueName(supabase, trade.league_id)

  await Promise.allSettled([
    sendTradeEmailNotifications(supabase, tradeOffer, 'completed', {
      notifyInitiator: true,
      notifyRecipient: true,
    }),
    sendDiscordNotification(supabase, {
      leagueId: trade.league_id,
      category: 'trades',
      embeds: [{
        author: buildEmbedAuthor(leagueName, trade.league_id),
        title: approvedEarly
          ? `Commissioner approved the trade between ${initiatorTeamName} and ${recipientTeamName}`
          : `Trade completed between ${initiatorTeamName} and ${recipientTeamName}`,
        color: DISCORD_COLORS.green,
        footer: { text: `Trade #${trade.id.slice(0, 8)}` },
        url: buildLeagueUrl(trade.league_id, '/trading'),
      }],
    }),
  ])
}

/**
 * Tell both sides of every offer that execute_trade expired because a movie it
 * named was traded away in the deal that just completed.
 *
 * Deliberately in-app only, matching notifyTradeExpired in process-trades:
 * losing a contested offer is expected traffic once competing offers are
 * allowed, and emailing every participant each time a popular movie moves would
 * be noise. The counterparty in the winning trade already gets a 'completed'
 * email.
 */
export async function notifyTradesInvalidated(
  supabase: ServiceClient,
  invalidated: InvalidatedTrade[]
): Promise<void> {
  const notifications: TradeNotification[] = []

  for (const offer of invalidated) {
    const [initiatorInfo, recipientInfo] = await Promise.all([
      getTeamInfo(supabase, offer.initiator_team_id),
      getTeamInfo(supabase, offer.recipient_team_id),
    ])

    for (const info of [initiatorInfo, recipientInfo]) {
      if (!info) continue
      notifications.push({
        user_id: info.user_id,
        league_id: offer.league_id,
        type: 'trade_cancelled',
        title: 'Trade No Longer Available',
        body: 'A movie in this trade was traded in another deal, so this offer has expired.',
        data: { trade_offer_id: offer.id, expired_reason: 'movie_traded_elsewhere' },
      })
    }
  }

  if (notifications.length > 0) {
    const { error } = await supabase.from('notifications').insert(notifications)
    if (error) {
      // Non-blocking: the offers are already expired in the DB, and the UI shows
      // that regardless. Losing the notification must not fail the caller.
      log.error('Failed to notify invalidated trade parties', { error: serializeError(error) })
    }
  }
}
