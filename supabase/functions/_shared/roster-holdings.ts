/**
 * Active-roster lookups shared by the scheduled notification functions
 * (release-day-announcements, weekly-releases-digest, sync-release-dates).
 *
 * Each of those jobs needs the same question answered: which leagues
 * currently hold these movies, and under whose team name.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/roster-holdings')

/** One league's active hold on a movie, via a draft pick or a pickup. */
export interface RosterHolding {
  movieId: string
  leagueId: string
  teamName: string
}

interface HoldingRow {
  movie_id: string
  league_id: string
  team_name: string | null
}

/**
 * PostgREST `in=(...)` filters travel in the query string, and Kong rejects
 * requests whose URI grows past ~8KB ("URI too long"). UUIDs are 36 chars,
 * so batches of this size stay comfortably under the limit.
 */
const MOVIE_ID_BATCH_SIZE = 150

async function fetchHoldingsBatch(
  serviceClient: SupabaseClient,
  movieIds: string[] | undefined
): Promise<HoldingRow[]> {
  let query = serviceClient.from('team_holdings').select('movie_id, league_id, team_name')

  if (movieIds) {
    query = query.in('movie_id', movieIds)
  }

  const { data, error } = await query

  if (error) {
    log.error('Failed to load team holdings', { error: serializeError(error) })
    return []
  }

  return (data ?? []) as HoldingRow[]
}

/**
 * Active roster = the `team_holdings` view, which unions draft picks and
 * pickups and excludes dropped rows on both legs. See
 * docs/PLAN-discord-bot-parity.md §0.
 *
 * Omit `movieIds` to fetch every active holding (bounded by roster sizes,
 * so inherently small). When provided, IDs are queried in batches because
 * PostgREST `in` filters live in the URI and large sets blow the URI length
 * limit — that failure mode looks like "nothing is rostered" and silently
 * suppresses notifications.
 *
 * A failed batch is logged and treated as "no rows" rather than thrown, so
 * one broken query doesn't suppress the notifications the other batches
 * would still produce.
 */
export async function fetchRosterHoldings(
  serviceClient: SupabaseClient,
  movieIds?: string[]
): Promise<RosterHolding[]> {
  let rows: HoldingRow[]
  if (movieIds) {
    rows = []
    for (let i = 0; i < movieIds.length; i += MOVIE_ID_BATCH_SIZE) {
      rows.push(...(await fetchHoldingsBatch(serviceClient, movieIds.slice(i, i + MOVIE_ID_BATCH_SIZE))))
    }
  } else {
    rows = await fetchHoldingsBatch(serviceClient, undefined)
  }

  return rows.map((row) => ({
    movieId: row.movie_id,
    leagueId: row.league_id,
    teamName: row.team_name ?? 'A team',
  }))
}

function groupBy(holdings: RosterHolding[], key: (h: RosterHolding) => string): Map<string, RosterHolding[]> {
  const groups = new Map<string, RosterHolding[]>()
  for (const holding of holdings) {
    const bucket = groups.get(key(holding)) ?? []
    bucket.push(holding)
    groups.set(key(holding), bucket)
  }
  return groups
}

export function groupHoldingsByLeague(holdings: RosterHolding[]): Map<string, RosterHolding[]> {
  return groupBy(holdings, (h) => h.leagueId)
}

export function groupHoldingsByMovie(holdings: RosterHolding[]): Map<string, RosterHolding[]> {
  return groupBy(holdings, (h) => h.movieId)
}
