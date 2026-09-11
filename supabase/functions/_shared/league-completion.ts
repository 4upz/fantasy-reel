/**
 * Ending a season.
 *
 * A season can be ended two ways -- the commissioner presses "End Season", or
 * the nightly `complete-seasons` cron finds the season past its `season_end`.
 * Both come through here, so there is exactly one definition of what "the
 * season is over" does: scores are refreshed one last time, the standings are
 * ranked once, the champion (or co-champions) are written onto the season row,
 * and everyone is told.
 *
 * The database transaction locks the season, refreshes scores, freezes its
 * result, and cancels pending activity together. A competing caller gets
 * `not_active` and sends nothing; any database failure leaves completion
 * retryable instead of permanently recording a partially refreshed winner.
 *
 * Notifications never roll anything back. By the time they run the season is
 * already closed and `winner_team_ids` is already written; a Discord webhook
 * that 500s or a Resend outage must not leave a season half-ended. Every
 * delivery path here logs its own failure and returns.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  sendDiscordNotification,
  DISCORD_COLORS,
  buildLeagueUrl,
  buildEmbedAuthor,
} from './discord.ts'
import { formatPoints } from './score-notifications.ts'
import { sendEmail } from './email.ts'
import { logNotificationDelivery, statusFromEmailResult } from './notification-log.ts'
import {
  championLine,
  getSeasonFinalStandingsEmailHtml,
  getSeasonFinalStandingsEmailText,
  type SeasonFinalStandingsRow,
} from './email-templates/season-final-standings.ts'
import { createLogger, serializeError } from './logger.ts'
import { COMPLETED_STATUS } from './league-status.ts'

const log = createLogger('shared/league-completion')

// ============================================================================
// Types
// ============================================================================

/** One row of `league_standings(p_league_id)`. Ranks are 1,2,2,4. */
export interface StandingRow {
  team_id: string
  team_name: string
  participant_id: string
  user_id: string
  total_points: number
  rank: number
  is_tied: boolean
}

/** The season row, as much of it as completion cares about. */
export interface CompletableLeague {
  id: string
  name: string
  status: string
  series_id: string
  season_year: number
  [key: string]: unknown
}

/**
 * A standings row as it is frozen onto `leagues.final_standings`.
 *
 * `display_name` is carried along rather than joined later: the point of the
 * snapshot is that it survives the people in it. A champion who leaves the
 * league, or deletes their profile, still has a name in their own history.
 */
export interface FinalStandingRow extends StandingRow {
  display_name: string | null
}

export type CompleteLeagueTrigger = 'owner' | 'cron'

export interface CompleteLeagueSuccess {
  ok: true
  /** The season row after completion -- callers echo this back to the client. */
  league: CompletableLeague
  standings: StandingRow[]
  /** Every team at rank 1. More than one means co-champions. */
  winnerTeamIds: string[]
  /** Pending pickup + counterpick bids voided uncharged by the close. */
  voidedBids: number
  /** Open trade offers expired by the close. */
  expiredTrades: number
}

export interface CompleteLeagueFailure {
  ok: false
  reason: 'not_found' | 'not_active' | 'not_due'
}

export type CompleteLeagueResult = CompleteLeagueSuccess | CompleteLeagueFailure

/** Medals for the podium; ranks below 3rd are not shown in the embed. */
const STANDING_MEDALS = ['🥇', '🥈', '🥉']

const PODIUM_SIZE = 3

// ============================================================================
// Entry point
// ============================================================================

export async function completeLeague(
  serviceClient: SupabaseClient,
  leagueId: string,
  options: { trigger: CompleteLeagueTrigger }
): Promise<CompleteLeagueResult> {
  const { data, error } = await serviceClient.rpc('complete_league_season', {
    p_league_id: leagueId,
    p_trigger: options.trigger,
  })
  if (error) {
    throw new Error(`Failed to complete league ${leagueId}: ${error.message}`)
  }
  if (!data) throw new Error(`Completion returned no result for league ${leagueId}`)

  const result = data as CompleteLeagueResult
  if (!result.ok) return result

  const { league, standings, winnerTeamIds, voidedBids, expiredTrades } = result
  log.info('Season completed', {
    league_id: leagueId,
    series_id: league.series_id,
    season_year: league.season_year,
    trigger: options.trigger,
    winner_team_ids: winnerTeamIds,
    voided_bids: voidedBids,
    expired_trades: expiredTrades,
  })

  // The transaction has committed; delivery failures cannot undo completion.
  // Names for the result were snapshotted in SQL, before any account lookup.
  try {
    const recipients = await resolveRecipients(serviceClient, standings.map((row) => row.user_id))
    await notifySeasonCompleted(serviceClient, league, standings, winnerTeamIds, recipients)
  } catch (error) {
    log.error('Failed to resolve season completion recipients', {
      league_id: leagueId,
      error: serializeError(error),
    })
  }
  return result
}

async function activeParticipants(
  serviceClient: SupabaseClient,
  leagueId: string
): Promise<Array<{ id: string; user_id: string }>> {
  const { data, error } = await serviceClient
    .from('league_participants')
    .select('id, user_id')
    .eq('league_id', leagueId)
    .eq('status', 'active')
  if (error) throw error
  return data ?? []
}

// ============================================================================
// Reigning champion
// ============================================================================

/**
 * The users who won the previous season of this series.
 *
 * Resolved to USERS, not teams: each season has its own `teams` rows, so last
 * year's winning team id means nothing in this year's standings. The person is
 * what carries over, which is also what "reigning champion" means to a reader.
 *
 * Returns an empty set for the first season of a series, or when the previous
 * season predates completion tracking and has no `winner_team_ids`.
 */
export async function reigningChampionUserIds(
  serviceClient: SupabaseClient,
  seriesId: string,
  seasonYear: number
): Promise<Set<string>> {
  const empty = new Set<string>()

  try {
    const { data: previous, error } = await serviceClient
      .from('leagues')
      .select('winner_team_ids')
      .eq('series_id', seriesId)
      .eq('season_year', seasonYear - 1)
      .eq('status', COMPLETED_STATUS)
      .maybeSingle()

    if (error || !previous?.winner_team_ids?.length) return empty

    const { data: teams } = await serviceClient
      .from('teams')
      .select('participant_id')
      .in('id', previous.winner_team_ids as string[])

    const participantIds = (teams ?? []).map((t: { participant_id: string }) => t.participant_id)
    if (participantIds.length === 0) return empty

    const { data: participants } = await serviceClient
      .from('league_participants')
      .select('user_id')
      .in('id', participantIds)

    return new Set((participants ?? []).map((p: { user_id: string }) => p.user_id))
  } catch (error) {
    // A missing crown is cosmetic; never let it stop the announcement.
    log.error('Failed to resolve reigning champions', {
      series_id: seriesId,
      season_year: seasonYear,
      error: serializeError(error),
    })
    return empty
  }
}

// ============================================================================
// Notifications
// ============================================================================

async function notifySeasonCompleted(
  serviceClient: SupabaseClient,
  league: CompletableLeague,
  standings: StandingRow[],
  winnerTeamIds: string[],
  recipients: RecipientMap
): Promise<void> {
  try {
    const championNames = standings
      .filter((row) => winnerTeamIds.includes(row.team_id))
      .map((row) => row.team_name)

    const reigning = await reigningChampionUserIds(serviceClient, league.series_id, league.season_year)

    // Each channel is independent, and every delivery settles before returning.
    const deliveries = await Promise.allSettled([
      sendFinalStandingsEmbed(serviceClient, league, standings, reigning),
      insertSeasonCompletedNotifications(serviceClient, league, championNames, winnerTeamIds),
      sendFinalStandingsEmails(serviceClient, league, standings, championNames, recipients),
    ])
    for (const delivery of deliveries) {
      if (delivery.status === 'rejected') {
        log.error('Season completion delivery failed', {
          league_id: league.id,
          error: serializeError(delivery.reason),
        })
      }
    }
  } catch (error) {
    log.error('Failed to send season completion notifications', {
      league_id: league.id,
      error: serializeError(error),
    })
  }
}

/**
 * The scores-channel wrap-up embed. Moved here from update-league's
 * `complete_league` handler so the cron path posts the identical message --
 * two announcements of the same event should not read differently depending on
 * who or what ended the season.
 */
async function sendFinalStandingsEmbed(
  serviceClient: SupabaseClient,
  league: CompletableLeague,
  standings: StandingRow[],
  reigningChampions: Set<string>
): Promise<void> {
  const podium = standings.filter((row) => row.rank <= PODIUM_SIZE)
  if (podium.length === 0) return

  const fields = podium.map((row) => ({
    // 👑 marks the team whose manager won the previous season, so the channel
    // can see at a glance whether the title was defended.
    name: `${STANDING_MEDALS[row.rank - 1]} ${row.team_name}${reigningChampions.has(row.user_id) ? ' 👑' : ''}`,
    value: `${formatPoints(row.total_points)} pts`,
    inline: true,
  }))

  await sendDiscordNotification(serviceClient, {
    leagueId: league.id,
    category: 'scores',
    embeds: [{
      author: buildEmbedAuthor(league.name, league.id),
      title: '🏆 Season Final Standings',
      description: `${league.name} has wrapped up! Final standings:`,
      fields,
      color: DISCORD_COLORS.green,
      footer: { text: `${league.season_year} Season` },
      url: buildLeagueUrl(league.id, '/standings'),
    }],
  })
}

async function insertSeasonCompletedNotifications(
  serviceClient: SupabaseClient,
  league: CompletableLeague,
  championNames: string[],
  winnerTeamIds: string[]
): Promise<void> {
  const participants = await activeParticipants(serviceClient, league.id)
  if (participants.length === 0) return

  const rows = participants.map((participant) => ({
    user_id: participant.user_id,
    league_id: league.id,
    type: 'season_completed',
    title: `${league.name}: ${league.season_year} season complete`,
    body: championLine(championNames),
    data: {
      league_id: league.id,
      series_id: league.series_id,
      season_year: league.season_year,
      winner_team_ids: winnerTeamIds,
    },
  }))

  const { error } = await serviceClient.from('notifications').insert(rows)
  if (error) {
    log.error('Failed to insert season completed notifications', {
      league_id: league.id,
      error: serializeError(error),
    })
  }
}

async function sendFinalStandingsEmails(
  serviceClient: SupabaseClient,
  league: CompletableLeague,
  standings: StandingRow[],
  championNames: string[],
  recipients: RecipientMap
): Promise<void> {
  if (standings.length === 0) return

  const leagueUrl = buildLeagueUrl(league.id)

  for (const row of standings) {
    const recipient = recipients.get(row.user_id)
    if (!recipient?.email) continue

    const emailData = {
      recipientName: recipient.name,
      leagueName: league.name,
      seasonYear: league.season_year,
      leagueUrl,
      championNames,
      standings: standings.map((s): SeasonFinalStandingsRow => ({
        rank: s.rank,
        teamName: s.team_name,
        points: s.total_points,
        isRecipient: s.team_id === row.team_id,
      })),
    }

    const metadata = {
      league_id: league.id,
      series_id: league.series_id,
      season_year: league.season_year,
    }

    try {
      const result = await sendEmail({
        to: recipient.email,
        subject: `${league.name}: ${league.season_year} final standings`,
        html: getSeasonFinalStandingsEmailHtml(emailData),
        text: getSeasonFinalStandingsEmailText(emailData),
      })

      await logNotificationDelivery(serviceClient, {
        notificationType: 'season_completed',
        recipientEmail: recipient.email,
        recipientUserId: row.user_id,
        status: statusFromEmailResult(result),
        messageId: result.messageId,
        errorMessage: result.error,
        metadata,
      })
    } catch (error) {
      log.error('Failed to send final standings email', {
        league_id: league.id,
        error: serializeError(error),
      })
      await logNotificationDelivery(serviceClient, {
        notificationType: 'season_completed',
        recipientEmail: recipient.email,
        recipientUserId: row.user_id,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata,
      })
    }
  }
}

/** userId -> the display name and address to reach them at. */
export type RecipientMap = Map<string, { name: string; email?: string }>

/**
 * Display names and email addresses for a set of users.
 *
 * Names come from `profiles` in one query; addresses have to come from the
 * auth admin API one user at a time, since `auth.users` is not exposed through
 * PostgREST. League sizes are capped at 20, so that is a bounded handful of
 * calls.
 *
 * Called after the completion transaction, solely for notification delivery.
 */
async function resolveRecipients(
  serviceClient: SupabaseClient,
  userIds: string[]
): Promise<RecipientMap> {
  const recipients: RecipientMap = new Map()
  const uniqueIds = [...new Set(userIds)]
  if (uniqueIds.length === 0) return recipients

  const { data: profiles } = await serviceClient
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', uniqueIds)

  const nameByUser = new Map(
    (profiles ?? []).map((p: { user_id: string; display_name: string | null }) => [
      p.user_id,
      p.display_name,
    ])
  )

  const lookups = await Promise.allSettled(
    uniqueIds.map((userId) => serviceClient.auth.admin.getUserById(userId))
  )

  uniqueIds.forEach((userId, i) => {
    const lookup = lookups[i]
    const email =
      lookup.status === 'fulfilled' ? lookup.value.data?.user?.email ?? undefined : undefined
    recipients.set(userId, { name: nameByUser.get(userId) || 'Fantasy Manager', email })
  })

  return recipients
}
