import type { FinalStandingRow, StandingRow } from '@/types'

/**
 * A season year is always set like a number stencilled on a film can: mono,
 * flat, letter-spaced. Never `font-display` (that is for names) and never a
 * `.badge` (those carry status colour). One constant so the surfaces that print
 * a year cannot drift apart.
 *
 * Size is left to the caller - the same stencil reads at 11px in a pill and at
 * `text-sm` down a history spine.
 */
export const SEASON_YEAR_CLASS = 'font-mono tracking-[0.08em]'

/** The year with its own chrome, for the surfaces that sit it beside a badge. */
export const SEASON_PILL_CLASS = `rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] text-foreground-secondary ${SEASON_YEAR_CLASS}`

export interface Champion {
  teamId: string
  /** Null when the winning team is no longer in the league - see championName(). */
  teamName: string | null
  ownerName: string | null
}

/**
 * The rows a season's table and champion are read from.
 *
 * `leagues.final_standings` is the record: written once at completion, it keeps
 * the owner names inline and keeps teams whose participant has since left the
 * league - both of which the live `league_standings` RPC drops, since it only
 * returns active participants. The RPC is the source only while a season is
 * still running, or for the rare completed season stamped before the snapshot
 * existed.
 */
export function seasonStandings(
  finalStandings: FinalStandingRow[] | null | undefined,
  liveStandings: StandingRow[]
): StandingRow[] {
  return finalStandings?.length ? finalStandings : liveStandings
}

/**
 * The teams that hold a completed season's title.
 *
 * Reading from `final_standings` gives every champion a name and an owner. When
 * the fallback RPC is all there is, a champion who later left the league is
 * missing from it entirely - the id is still meaningful, so the name degrades
 * to null rather than the row disappearing, and callers print "Team removed".
 */
export function resolveChampions(
  winnerTeamIds: string[] | null,
  standings: (StandingRow | FinalStandingRow)[],
  ownerNameByUserId?: Map<string, string | null>
): Champion[] {
  if (!winnerTeamIds?.length) return []

  const byTeamId = new Map(standings.map((row) => [row.team_id, row]))

  return winnerTeamIds.map((teamId) => {
    const row = byTeamId.get(teamId)
    if (!row) return { teamId, teamName: null, ownerName: null }

    // A frozen row names its owner inline; a live RPC row has to be matched up
    // with the profiles the caller already loaded.
    const inlineOwnerName = 'display_name' in row ? row.display_name : null

    return {
      teamId,
      teamName: row.team_name,
      ownerName: inlineOwnerName ?? ownerNameByUserId?.get(row.user_id) ?? null,
    }
  })
}

/** The champions' points. Co-champions are tied, so there is only ever one figure. */
export function championPoints(
  champions: Champion[],
  standings: (StandingRow | FinalStandingRow)[]
): number | null {
  const first = standings.find((row) => champions.some((c) => c.teamId === row.team_id))
  return first?.total_points ?? null
}

export function championName(champion: Champion): string {
  return champion.teamName ?? 'Team removed'
}

/**
 * "Academy Aces", "Academy Aces and Award Hunters", "Alice, Bob and 2 others".
 * Every consumer of a tie has to say it in the plural - a lone gold chip on two
 * rows reads as a rendering bug without the words.
 */
export function formatChampionNames(champions: Champion[]): string {
  const names = champions.map(championName)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`
}

/** `YYYY-MM-DD` as "Dec 31", read as a calendar date rather than a UTC instant. */
export function formatSeasonDate(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number)
  if (!year || !month || !day) return dateOnly
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Whole days from today to a `YYYY-MM-DD` date. Negative once it has passed.
 * Both sides are floored to local midnight so "today" is 0, not 0.4.
 */
export function daysUntil(dateOnly: string, now: Date = new Date()): number {
  const [year, month, day] = dateOnly.split('-').map(Number)
  const target = new Date(year, month - 1, day).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((target - today) / 86_400_000)
}

/**
 * Groups seasons into their series, newest season first inside each group, and
 * the groups themselves ordered by the season you would be shown.
 *
 * The dashboard lists leagues, not seasons - a league with four years of
 * history is still one entry - so the flat `leagues` list has to be folded back
 * into series before it is rendered.
 *
 * Group order follows the order the leagues arrive in, so whatever the caller
 * sorted by (newest first, today) survives the grouping.
 */
export function groupLeaguesIntoSeries<T extends { series_id: string; season_year: number; status: string }>(
  leagues: T[]
): T[][] {
  const bySeries = new Map<string, T[]>()
  for (const league of leagues) {
    const group = bySeries.get(league.series_id)
    if (group) group.push(league)
    else bySeries.set(league.series_id, [league])
  }

  return [...bySeries.values()].map((group) =>
    [...group].sort((a, b) => b.season_year - a.season_year)
  )
}

/**
 * The season a series card, switcher or history page opens on: the one still
 * being played, or the most recent if they are all finished.
 */
export function currentSeasonOf<T extends { season_year: number; status: string }>(
  seasons: T[]
): T | null {
  if (seasons.length === 0) return null
  const running = seasons.filter((s) => s.status !== 'completed')
  const pool = running.length > 0 ? running : seasons
  return pool.reduce((latest, season) => (season.season_year > latest.season_year ? season : latest))
}
