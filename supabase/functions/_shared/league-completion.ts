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
 * The state change is a check-and-set on `status = 'active'`. Two callers
 * racing -- the owner clicking as the cron runs -- means the loser gets
 * `not_active` and sends nothing, rather than a second set of final-standings
 * announcements naming a champion that was already named.
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
import { OPEN_TRADE_STATUSES } from './trade-expiry.ts'

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
  reason: 'not_found' | 'not_active'
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
  const { data: league, error: leagueError } = await serviceClient
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .maybeSingle()

  if (leagueError) {
    // A read failure is not a business answer -- let the caller's outer catch
    // turn it into a 500 rather than reporting the season as missing.
    throw new Error(`Failed to load league ${leagueId}: ${leagueError.message}`)
  }
  if (!league) return { ok: false, reason: 'not_found' }
  if (league.status !== 'active') return { ok: false, reason: 'not_active' }

  await refreshTeamScores(serviceClient, leagueId)

  const standings = await loadStandings(serviceClient, leagueId)
  const winnerTeamIds = standings.filter((row) => row.rank === 1).map((row) => row.team_id)

  // Resolved before the state change because the snapshot needs the names, and
  // the emails below reuse the same lookup rather than repeating it.
  const recipients = await resolveRecipients(serviceClient, standings.map((row) => row.user_id))
  const finalStandings: FinalStandingRow[] = standings.map((row) => ({
    ...row,
    display_name: recipients.get(row.user_id)?.name ?? null,
  }))

  // Check-and-set. The `.eq('status', 'active')` is the whole race guard: the
  // second caller matches no rows and comes back with `not_active`.
  const { data: updatedLeague, error: updateError } = await serviceClient
    .from('leagues')
    .update({
      status: COMPLETED_STATUS,
      completed_at: new Date().toISOString(),
      winner_team_ids: winnerTeamIds,
      final_standings: finalStandings,
    })
    .eq('id', leagueId)
    .eq('status', 'active')
    .select()
    .maybeSingle()

  if (updateError) {
    throw new Error(`Failed to complete league ${leagueId}: ${updateError.message}`)
  }
  if (!updatedLeague) return { ok: false, reason: 'not_active' }

  const completed = updatedLeague as CompletableLeague

  // Only the caller that won the race gets here, so the season is closed
  // exactly once and everything below runs exactly once.
  const { voidedBids, expiredTrades } = await freezePendingActivity(serviceClient, leagueId)

  log.info('Season completed', {
    league_id: leagueId,
    series_id: completed.series_id,
    season_year: completed.season_year,
    trigger: options.trigger,
    winner_team_ids: winnerTeamIds,
    voided_bids: voidedBids,
    expired_trades: expiredTrades,
  })

  // Past the point of no return. Everything below is announcement.
  await notifySeasonCompleted(serviceClient, completed, standings, winnerTeamIds, recipients)

  return { ok: true, league: completed, standings, winnerTeamIds, voidedBids, expiredTrades }
}

// ============================================================================
// Freezing what was still in flight
// ============================================================================

/** `pickup_bids` / `counterpick_bids` statuses that are still in contention. */
const PENDING_BID_STATUSES = ['active', 'outbid']

/**
 * Close out everything that could still change a roster after the standings
 * are final.
 *
 * Without this the season's result is not actually final: `process-bids` would
 * happily award a pending bid, and `process-trades` would execute an
 * already-accepted offer whose review window happened to lapse the next
 * morning -- both moving rosters after the champion was announced.
 *
 * Bids go to `cancelled`, not `lost`: `lost` means beaten in a contest, and
 * charging or telling a team they were outbid would both be untrue. `cancelled`
 * is the status process-bids already uses for a bid voided uncharged.
 *
 * Failures are logged and counted rather than thrown. The season is already
 * closed by this point -- raising here would abandon the announcements and
 * leave the state half-applied, with no retry that could complete it.
 */
async function freezePendingActivity(
  serviceClient: SupabaseClient,
  leagueId: string
): Promise<{ voidedBids: number; expiredTrades: number }> {
  const [pickup, counterpick] = await Promise.all([
    voidPendingBids(serviceClient, leagueId, 'pickup_bids'),
    voidPendingBids(serviceClient, leagueId, 'counterpick_bids'),
  ])

  return {
    voidedBids: pickup + counterpick,
    expiredTrades: await expireOpenTrades(serviceClient, leagueId),
  }
}

async function voidPendingBids(
  serviceClient: SupabaseClient,
  leagueId: string,
  table: 'pickup_bids' | 'counterpick_bids'
): Promise<number> {
  const { data, error } = await serviceClient
    .from(table)
    .update({ status: 'cancelled' })
    .eq('league_id', leagueId)
    .in('status', PENDING_BID_STATUSES)
    .select('id')

  if (error) {
    log.error('Failed to void pending bids on season completion', {
      league_id: leagueId,
      table,
      error: serializeError(error),
    })
    return 0
  }

  return (data ?? []).length
}

async function expireOpenTrades(
  serviceClient: SupabaseClient,
  leagueId: string
): Promise<number> {
  const { data, error } = await serviceClient
    .from('trade_offers')
    .update({ status: 'expired', expired_reason: 'season_completed' })
    .eq('league_id', leagueId)
    .in('status', OPEN_TRADE_STATUSES)
    .select('id')

  if (error) {
    log.error('Failed to expire open trades on season completion', {
      league_id: leagueId,
      error: serializeError(error),
    })
    return 0
  }

  return (data ?? []).length
}

// ============================================================================
// Scores and standings
// ============================================================================

/**
 * One last recalculation before the numbers are frozen, so anything scored
 * since the last nightly run is counted.
 *
 * Best-effort on purpose. `team_scores` is already maintained by
 * `update-scores` twice a day, so a failure here costs at most a few hours of
 * freshness -- whereas refusing to ever close the season over it would leave
 * the league stuck open with no way out. Failures are logged loudly instead.
 */
async function refreshTeamScores(serviceClient: SupabaseClient, leagueId: string): Promise<void> {
  try {
    const teamIds = await activeTeamIds(serviceClient, leagueId)

    const results = await Promise.allSettled(
      teamIds.map((teamId) =>
        serviceClient.rpc('recalculate_team_score_with_counterpicks', { p_team_id: teamId })
      )
    )

    results.forEach((result, i) => {
      const failure =
        result.status === 'rejected'
          ? result.reason
          : (result.value as { error?: unknown } | null)?.error
      if (failure) {
        log.error('Failed to recalculate team score before completion', {
          league_id: leagueId,
          team_id: teamIds[i],
          error: serializeError(failure),
        })
      }
    })
  } catch (error) {
    log.error('Failed to refresh team scores before completion', {
      league_id: leagueId,
      error: serializeError(error),
    })
  }
}

async function activeTeamIds(serviceClient: SupabaseClient, leagueId: string): Promise<string[]> {
  const participants = await activeParticipants(serviceClient, leagueId)
  if (participants.length === 0) return []

  const { data: teams, error } = await serviceClient
    .from('teams')
    .select('id')
    .in('participant_id', participants.map((p) => p.id))

  if (error) {
    log.error('Failed to load teams for league', { league_id: leagueId, error: serializeError(error) })
    return []
  }

  return (teams ?? []).map((t: { id: string }) => t.id)
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

  if (error) {
    log.error('Failed to load league participants', { league_id: leagueId, error: serializeError(error) })
    return []
  }

  return (data ?? []) as Array<{ id: string; user_id: string }>
}

/**
 * The one ranking. `league_standings` decides ties, so the champion set, the
 * Discord embed, the email table and the standings page can never disagree
 * about who won.
 */
async function loadStandings(
  serviceClient: SupabaseClient,
  leagueId: string
): Promise<StandingRow[]> {
  const { data, error } = await serviceClient.rpc('league_standings', { p_league_id: leagueId })

  if (error) {
    // Unlike the score refresh, this one is fatal: there is no honest way to
    // stamp a champion onto the season without it.
    throw new Error(`Failed to compute standings for league ${leagueId}: ${error.message}`)
  }

  return ((data ?? []) as StandingRow[]).map((row) => ({
    ...row,
    total_points: Number(row.total_points ?? 0),
  }))
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

    // Sequential, not parallel: Discord and Resend are separate outbound
    // services and the isolate can be torn down once the caller responds, so
    // each is awaited to completion.
    await sendFinalStandingsEmbed(serviceClient, league, standings, reigning)
    await insertSeasonCompletedNotifications(serviceClient, league, championNames, winnerTeamIds)
    await sendFinalStandingsEmails(serviceClient, league, standings, championNames, recipients)
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
  const podium = standings.slice(0, PODIUM_SIZE)
  if (podium.length === 0) return

  const fields = podium.map((row, i) => ({
    // 👑 marks the team whose manager won the previous season, so the channel
    // can see at a glance whether the title was defended.
    name: `${STANDING_MEDALS[i]} ${row.team_name}${reigningChampions.has(row.user_id) ? ' 👑' : ''}`,
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
 * Called once per completion, before the state change, because the
 * `final_standings` snapshot needs the names too.
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
