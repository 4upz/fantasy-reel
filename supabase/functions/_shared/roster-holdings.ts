/**
 * Active-roster lookups shared by the scheduled notification functions
 * (release-day-announcements, weekly-releases-digest, sync-release-dates).
 *
 * Each of those jobs starts from a set of movie IDs and needs the same
 * question answered: which leagues currently hold these movies, and under
 * whose team name.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** One league's active hold on a movie, via a draft pick or a pickup. */
export interface RosterHolding {
  movieId: string
  leagueId: string
  teamName: string
}

interface HoldingRow {
  movie_id: string
  league_id: string
  teams: { name: string } | { name: string }[] | null
}

/** Normalizes PostgREST embeds, which type single rows as arrays. */
function firstOf<T>(value: T | T[] | null): T | null {
  if (value === null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

/**
 * Active roster = draft_picks with dropped_at IS NULL, plus pickups with
 * dropped_at IS NULL. See docs/PLAN-discord-bot-parity.md §0.
 *
 * A failure on either side is logged and treated as "no rows from that
 * table" rather than thrown, so one broken query doesn't suppress the
 * notifications the other side would still produce.
 */
export async function fetchRosterHoldings(
  serviceClient: SupabaseClient,
  movieIds: string[]
): Promise<RosterHolding[]> {
  const [picks, pickups] = await Promise.all([
    serviceClient
      .from('draft_picks')
      .select('movie_id, league_id, teams!draft_picks_team_id_fkey(name)')
      .in('movie_id', movieIds)
      .is('dropped_at', null),
    serviceClient
      .from('pickups')
      .select('movie_id, league_id, teams!pickups_team_id_fkey(name)')
      .in('movie_id', movieIds)
      .is('dropped_at', null),
  ])

  if (picks.error) console.error('Failed to load draft picks:', picks.error)
  if (pickups.error) console.error('Failed to load pickups:', pickups.error)

  const rows = [...(picks.data ?? []), ...(pickups.data ?? [])] as HoldingRow[]

  return rows.map((row) => ({
    movieId: row.movie_id,
    leagueId: row.league_id,
    teamName: firstOf(row.teams)?.name ?? 'A team',
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
