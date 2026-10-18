/**
 * In-app notifications about rostered movies: a score arriving or moving, a
 * pre-release score starting to count, and release day. Until these existed
 * only Discord heard about them; as notification rows they reach the inbox
 * and, through the push_outbox trigger, the iOS app (O-01).
 *
 * Who hears what, per league holding the movie:
 *   - the team holding it, and the team that counterpicked it, get
 *     `movie_scored` / `movie_released` (a counterpicker's points inverted);
 *   - everyone else in the league gets `league_movie_scored` when a movie
 *     gets its first score, and nothing for later moves.
 * Completed seasons hear nothing.
 *
 * Callers record their own Discord dedupe before calling, so a rerun never
 * repeats these. Failures are logged and never thrown: a notification must
 * not break scoring or the release-day job.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { leagueFantasyPoints } from './fantasy-points.ts'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/movie-inbox')

/**
 * - `scored`: the movie's first Tomatometer score
 * - `moved`: a move past the posting threshold
 * - `counts`: it released, so a score posted before release now counts
 * - `released`: it's out today
 */
export type MovieInboxKind = 'scored' | 'moved' | 'counts' | 'released'

export interface MovieInboxEvent {
  movieId: string
  title: string
  kind: MovieInboxKind
  /** Tomatometer, when the movie has one. */
  rtScore: number | null
  /** `movies.fantasy_points` (the default 90+ rule); null while unscored. */
  points: number | null
  /** Whether the points count toward team totals yet. */
  released: boolean
}

export interface InboxRow {
  user_id: string
  league_id: string
  type: 'movie_scored' | 'movie_released' | 'league_movie_scored'
  title: string
  body: string
  data: Record<string, unknown>
}

interface League {
  id: string
  name: string
  status: string
  double_points_over_90: boolean
}

interface Member {
  userId: string
  teamId: string
  teamName: string
}

/** Where one league holds one movie. */
export interface MovieStake {
  leagueId: string
  movieId: string
  holder: { teamId: string; teamName: string } | null
  counterpicker: { teamId: string; teamName: string } | null
}

/** "+36", "−4", "+12.5": whole numbers unless the curve gave a fraction. */
export function formatSignedPoints(points: number): string {
  const rounded = Math.sign(points) * Math.round(Math.abs(points) * 10) / 10
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1)
  return `${rounded < 0 ? '−' : '+'}${text}`
}

function pointsWord(points: number): string {
  return Math.abs(points) === 1 ? 'point' : 'points'
}

/** The sentence for the holder or counterpicker of a movie. */
export function stakeMessage(
  event: MovieInboxEvent,
  league: { name: string },
  team: { teamName: string },
  points: number | null,
  counterpick: boolean,
): { title: string; body: string } {
  const rt = event.rtScore === null ? null : `${Math.round(event.rtScore)}%`
  const whose = counterpick ? `Your counterpick on ${event.title}` : event.title
  const worth = points === null ? '' : `${formatSignedPoints(points)} ${pointsWord(points)}`
  const forTeam = `for ${team.teamName} in ${league.name}`

  switch (event.kind) {
    case 'released':
      return {
        title: `${event.title} is out today`,
        body: counterpick
          ? `Your counterpick for ${team.teamName} in ${league.name} counts from today.`
          : `It's on ${team.teamName}'s roster in ${league.name}, and its score counts from today.`,
      }
    case 'counts':
      return {
        title: `${event.title}'s score now counts`,
        body: `${counterpick ? 'Your counterpick' : 'It'} is worth ${worth} ${forTeam}.`,
      }
    case 'moved':
      return {
        title: `${whose} moved to ${rt ?? 'a new score'}`,
        body: event.released ? `Now ${worth} ${forTeam}.` : `Worth ${worth} ${forTeam} once it releases.`,
      }
    case 'scored':
      return {
        title: `${whose} scored ${rt ?? 'its first score'}`,
        body: event.released ? `That's ${worth} ${forTeam}.` : `Worth ${worth} ${forTeam} once it releases.`,
      }
  }
}

/** Builds every row for these events. Pure, so the fan-out rules are testable. */
export function buildMovieInboxRows(
  events: MovieInboxEvent[],
  leagues: Map<string, League>,
  members: Map<string, Member[]>,
  stakes: MovieStake[],
): InboxRow[] {
  const byMovie = new Map(events.map((e) => [e.movieId, e]))
  const rows: InboxRow[] = []

  for (const stake of stakes) {
    const event = byMovie.get(stake.movieId)
    const league = leagues.get(stake.leagueId)
    if (!event || !league || league.status === 'completed') continue
    const leagueMembers = members.get(stake.leagueId) ?? []
    const userOf = (teamId: string) => leagueMembers.find((m) => m.teamId === teamId)?.userId
    const points = event.points === null
      ? null
      : leagueFantasyPoints(event.points, event.rtScore, league.double_points_over_90)
    const type = event.kind === 'released' ? 'movie_released' : 'movie_scored'
    const told = new Set<string>()

    for (const [team, counterpick] of [[stake.holder, false], [stake.counterpicker, true]] as const) {
      const userId = team ? userOf(team.teamId) : undefined
      if (!team || !userId || told.has(userId)) continue
      told.add(userId)
      const teamPoints = points === null ? null : counterpick ? -points : points
      rows.push({
        user_id: userId,
        league_id: stake.leagueId,
        type,
        ...stakeMessage(event, league, team, teamPoints, counterpick),
        data: { movie_id: event.movieId, team_id: team.teamId, rt_score: event.rtScore, points: teamPoints },
      })
    }

    if (event.kind === 'scored' && stake.holder && points !== null) {
      const rt = event.rtScore === null ? 'its first score' : `${Math.round(event.rtScore)}%`
      for (const member of leagueMembers) {
        if (told.has(member.userId)) continue
        rows.push({
          user_id: member.userId,
          league_id: stake.leagueId,
          type: 'league_movie_scored',
          title: `${event.title} scored ${rt}`,
          body: `${stake.holder.teamName}'s movie in ${league.name}: ${formatSignedPoints(points)} ${pointsWord(points)}${event.released ? '' : ' once it releases'}.`,
          data: { movie_id: event.movieId, team_id: stake.holder.teamId, rt_score: event.rtScore, points },
        })
      }
    }
  }
  return rows
}

/** PostgREST `in` filters live in the URL; see roster-holdings.ts. */
const ID_BATCH = 150
const INSERT_BATCH = 500

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function loadStakes(client: SupabaseClient, leagueIds: string[], movieIds: string[]): Promise<MovieStake[]> {
  const stakes = new Map<string, MovieStake>()
  const stakeFor = (leagueId: string, movieId: string) => {
    const key = `${leagueId}:${movieId}`
    let stake = stakes.get(key)
    if (!stake) {
      stake = { leagueId, movieId, holder: null, counterpicker: null }
      stakes.set(key, stake)
    }
    return stake
  }

  for (const ids of chunks(movieIds, ID_BATCH)) {
    const [holdings, counterpicks] = await Promise.all([
      client.from('team_holdings').select('league_id, movie_id, team_id, team_name')
        .in('league_id', leagueIds).in('movie_id', ids),
      // A counterpick survives its movie being dropped, so it is read from
      // its own table rather than through the holding.
      client.from('counterpicks')
        .select('league_id, movie_id, counterpicker_team_id, teams!counterpicks_counterpicker_team_id_fkey(name)')
        .in('league_id', leagueIds).in('movie_id', ids),
    ])
    if (holdings.error) throw holdings.error
    if (counterpicks.error) throw counterpicks.error
    for (const h of holdings.data ?? []) {
      stakeFor(h.league_id, h.movie_id).holder = { teamId: h.team_id, teamName: h.team_name }
    }
    for (const c of counterpicks.data ?? []) {
      const team = c.teams as unknown as { name: string } | null
      stakeFor(c.league_id, c.movie_id).counterpicker = { teamId: c.counterpicker_team_id, teamName: team?.name ?? 'Your team' }
    }
  }
  return [...stakes.values()]
}

async function loadMembers(client: SupabaseClient, leagueIds: string[]): Promise<Map<string, Member[]>> {
  const members = new Map<string, Member[]>()
  for (const ids of chunks(leagueIds, ID_BATCH)) {
    const { data, error } = await client.from('league_participants')
      .select('league_id, user_id, teams(id, name)')
      .in('league_id', ids)
      .eq('status', 'active')
    if (error) throw error
    for (const p of data ?? []) {
      const teams = (Array.isArray(p.teams) ? p.teams : [p.teams]) as Array<{ id: string; name: string } | null>
      const team = teams[0]
      if (!team || !p.user_id) continue
      const list = members.get(p.league_id) ?? []
      list.push({ userId: p.user_id, teamId: team.id, teamName: team.name })
      members.set(p.league_id, list)
    }
  }
  return members
}

/**
 * Inserts the notifications for `events` in `leagueIds`. Returns how many
 * were written; never throws.
 */
export async function notifyMovieEvents(
  client: SupabaseClient,
  events: MovieInboxEvent[],
  leagueIds: string[],
): Promise<number> {
  if (events.length === 0 || leagueIds.length === 0) return 0
  try {
    const { data: leagueRows, error } = await client.from('leagues')
      .select('id, name, status, double_points_over_90')
      .in('id', leagueIds)
    if (error) throw error
    const leagues = new Map(((leagueRows ?? []) as League[]).map((l) => [l.id, l]))
    const live = [...leagues.values()].filter((l) => l.status !== 'completed').map((l) => l.id)
    if (live.length === 0) return 0

    const [stakes, members] = await Promise.all([
      loadStakes(client, live, [...new Set(events.map((e) => e.movieId))]),
      loadMembers(client, live),
    ])
    const rows = buildMovieInboxRows(events, leagues, members, stakes)

    let written = 0
    for (const batch of chunks(rows, INSERT_BATCH)) {
      const { error: insertError } = await client.from('notifications').insert(batch)
      if (insertError) throw insertError
      written += batch.length
    }
    return written
  } catch (error) {
    log.error('Movie notifications failed', { error: serializeError(error), events: events.length })
    return 0
  }
}
