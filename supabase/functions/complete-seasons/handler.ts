/**
 * Core logic for complete-seasons, kept in a module separate from index.ts so
 * unit tests can import it without triggering index.ts's top-level
 * Deno.serve() (which would open a real listener as a side effect of the
 * import).
 *
 * Daily cron. Two jobs, both keyed off `leagues.season_end`:
 *
 *   1. Any active season whose end date has passed is completed, via the same
 *      `completeLeague` the commissioner's "End Season" button calls. Nobody
 *      has to remember to close their league.
 *   2. Any active season ending in exactly seven days gets one heads-up in
 *      Discord, so a last trade or waiver claim is still possible.
 *
 * The reminder is idempotent through `discord_notification_log` with
 * `movie_id IS NULL` -- the partial unique index added with the season schema
 * is what makes a same-day rerun a no-op rather than a second ping.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  sendDiscordNotification,
  DISCORD_COLORS,
  buildLeagueUrl,
  buildEmbedAuthor,
} from '../_shared/discord.ts'
import { completeLeague } from '../_shared/league-completion.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('complete-seasons')

const REMINDER_TYPE = 'season_end_reminder'
const REMINDER_LEAD_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The idempotency key for a season-end reminder, e.g.
 * `season_end_reminder:2026-12-31`.
 *
 * The date is part of the key on purpose. A bare type would mean a
 * commissioner who moves `season_end` never gets a second warning -- the
 * league would sail past its new end date having been told about the old one.
 * Keying on the date being warned about makes a moved deadline a genuinely new
 * event, while a rerun on the same date stays a no-op.
 */
function reminderType(seasonEnd: string): string {
  return `${REMINDER_TYPE}:${seasonEnd}`
}

export interface CompleteSeasonsResult {
  /** Seasons ended on this run. */
  seasons_completed: number
  /** Seasons that threw while completing; each is retried on the next run. */
  seasons_failed: number
  /** Seasons that were already no longer active by the time we got to them. */
  seasons_skipped: number
  /** Leagues that got a 7-day heads-up. */
  reminders_sent: number
  errors: unknown[]
}

interface LeagueRow {
  id: string
  name: string
  season_year: number
  season_end: string
}

/** A date offset by whole days, rendered as YYYY-MM-DD to match a DATE column. */
function dateOnly(from: Date, offsetDays = 0): string {
  return new Date(from.getTime() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10)
}

export async function runCompleteSeasons(
  serviceClient: SupabaseClient
): Promise<CompleteSeasonsResult> {
  const now = new Date()
  const result: CompleteSeasonsResult = {
    seasons_completed: 0,
    seasons_failed: 0,
    seasons_skipped: 0,
    reminders_sent: 0,
    errors: [],
  }

  await completeOverdueSeasons(serviceClient, dateOnly(now), result)
  await sendEndingSoonReminders(serviceClient, dateOnly(now, REMINDER_LEAD_DAYS), result)

  return result
}

async function completeOverdueSeasons(
  serviceClient: SupabaseClient,
  today: string,
  result: CompleteSeasonsResult
): Promise<void> {
  const { data: overdue, error } = await serviceClient
    .from('leagues')
    .select('id, name, season_year, season_end')
    .eq('status', 'active')
    .lt('season_end', today)

  if (error) {
    // Nothing else in this run depends on the list, but a failure to read it
    // means seasons silently stay open -- surface it as a job failure.
    throw new Error(`Failed to load overdue seasons: ${error.message}`)
  }

  for (const league of (overdue ?? []) as LeagueRow[]) {
    try {
      const outcome = await completeLeague(serviceClient, league.id, { trigger: 'cron' })

      if (outcome.ok) {
        result.seasons_completed++
      } else {
        // The commissioner beat us to it between the query and the update.
        // Not a failure -- the season is closed either way.
        result.seasons_skipped++
        log.info('Season no longer completable', { league_id: league.id, reason: outcome.reason })
      }
    } catch (err) {
      // One league's failure must not strand the rest of the run. Tomorrow's
      // run picks this one up again, since it is still active and still overdue.
      result.seasons_failed++
      result.errors.push({ league_id: league.id, error: serializeError(err) })
      log.error('Failed to complete season', {
        league_id: league.id,
        season_year: league.season_year,
        error: serializeError(err),
      })
    }
  }
}

async function sendEndingSoonReminders(
  serviceClient: SupabaseClient,
  reminderDate: string,
  result: CompleteSeasonsResult
): Promise<void> {
  const { data: ending, error } = await serviceClient
    .from('leagues')
    .select('id, name, season_year, season_end')
    .eq('status', 'active')
    .eq('season_end', reminderDate)

  if (error) {
    // A missed reminder is not worth failing the run that closed real seasons.
    log.error('Failed to load seasons ending soon', { error: serializeError(error) })
    return
  }

  for (const league of (ending ?? []) as LeagueRow[]) {
    // Claim the reminder before sending it. The partial unique index on
    // (league_id, notification_type) WHERE movie_id IS NULL turns a duplicate
    // into a 23505, so a rerun -- or two isolates racing -- sends once.
    // Claiming first also means a webhook failure does not earn a retry that
    // would double-post to the channels that did receive it.
    const { error: claimError } = await serviceClient
      .from('discord_notification_log')
      .insert({
        league_id: league.id,
        movie_id: null,
        notification_type: reminderType(league.season_end),
      })

    if (claimError) {
      if ((claimError as { code?: string }).code !== '23505') {
        log.error('Failed to claim season end reminder', {
          league_id: league.id,
          error: serializeError(claimError),
        })
      }
      continue
    }

    await sendDiscordNotification(serviceClient, {
      leagueId: league.id,
      category: 'general',
      embeds: [{
        author: buildEmbedAuthor(league.name, league.id),
        title: '⏳ Season ends in 7 days',
        description:
          `The ${league.season_year} season of **${league.name}** ends on ${league.season_end}. ` +
          'Final standings are locked in after that -- last chance for trades and pickups.',
        color: DISCORD_COLORS.yellow,
        footer: { text: `${league.season_year} Season` },
        url: buildLeagueUrl(league.id, '/standings'),
      }],
    })

    result.reminders_sent++
  }
}
