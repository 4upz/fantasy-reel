/**
 * Score notification utilities.
 *
 * Detects what changed during a score update run and emits Discord
 * notifications for four events:
 *   1. A movie receives its first score, or ends a run at least
 *      SCORE_CHANGE_THRESHOLD from the score last posted for it. Before
 *      release that is a pre-release score, and the post says its points
 *      count from release day.
 *   2. A movie whose score was posted before release has released, so its
 *      points now count.
 *   3. A team's total moves at least SCORE_CHANGE_THRESHOLD in one run.
 *   4. A team's rank in the league standings changes.
 *
 * Team totals only count released movies, so 3 and 4 never fire for a
 * pre-release score -- they wait for release day.
 *
 * Usage is a before/after sandwich around the score recalculation:
 *
 *   const context = await captureScoreContext(client, movieIds)
 *   ...recalculate scores...
 *   await sendScoreNotifications(client, context)
 *
 * Follows discord.ts conventions: never throws, catches internally, logs
 * failures with console.error.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { COMPLETED_STATUS } from './league-status.ts'
import { createLogger, serializeError } from './logger.ts'
import { hasReleased, utcDate } from './scoring.ts'
import {
  sendDiscordNotification,
  DISCORD_COLORS,
  DISCORD_MAX_EMBED_FIELDS,
  buildLeagueUrl,
  buildEmbedAuthor,
  delay,
  WEBHOOK_SEND_DELAY_MS,
  type DiscordEmbed,
} from './discord.ts'

const log = createLogger('score-notifications')

// ============================================================================
// Types
// ============================================================================

/** A team's position in a league at a point in time. */
export interface TeamStanding {
  teamId: string
  teamName: string
  points: number
  /** 1-based, ties share a rank (1, 2, 2, 4). */
  rank: number
}

/** Where a movie sits within a single league. */
export interface MoviePlacement {
  movieId: string
  leagueId: string
  ownerTeamName: string
  counterpickerTeamName: string | null
}

/** A movie a team dropped, still tracked for "notable miss" detection. */
export interface DroppedMoviePlacement {
  movieId: string
  leagueId: string
  droppedByTeamName: string
}

/** A movie's two scores at a point in time. Both are null while unscored. */
export interface MovieScoreSnapshot {
  /** `movies.fantasy_points` -- the curve applied to the Tomatometer. */
  points: number | null
  /** `movies.combined_score` -- the Tomatometer itself. */
  rtScore: number | null
}

/** Snapshot taken before scores are recalculated. */
export interface ScoreNotificationContext {
  /** The run's UTC date, which decides whether a movie has released. */
  today: string
  movieIds: string[]
  /** Leagues holding these movies, including via dropped roster slots. */
  leagueIds: string[]
  /** movieId -> scores before the update. */
  previousMovieScores: Map<string, MovieScoreSnapshot>
  /** leagueId -> league name. */
  leagueNames: Map<string, string>
  /** leagueId -> standings before the update. */
  previousStandings: Map<string, TeamStanding[]>
  placements: MoviePlacement[]
  /** Movies with no active roster holder in a league, for notable-miss detection. */
  droppedPlacements: DroppedMoviePlacement[]
}

/**
 * What a movie post says: its first score, a move from the score last posted,
 * or that a score posted before release now counts because it has released.
 */
export type MovieScoreChangeKind = 'new' | 'moved' | 'release'

/**
 * A movie's move from a starting score -- the pre-run snapshot for notable-miss
 * detection, the score last posted for it for a post -- to its current score.
 */
export interface MovieScoreChange {
  movieId: string
  title: string
  posterUrl: string | null
  previousPoints: number | null
  newPoints: number
  /** Tomatometer at the starting score; null if there was none. */
  previousRtScore: number | null
  /** Tomatometer after the update. Null only if the score was withdrawn. */
  newRtScore: number | null
  kind: MovieScoreChangeKind
  /** Whether the movie has released, so these points count toward team totals. */
  released: boolean
  releaseDate: string | null
}

/** A team whose score or rank changed. */
export interface StandingChange {
  teamId: string
  teamName: string
  previousPoints: number
  newPoints: number
  previousRank: number
  newRank: number
  pointsChanged: boolean
  rankChanged: boolean
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/** Scores are displayed to one decimal, matching the standings UI. */
export function formatPoints(points: number): string {
  return points.toFixed(1)
}

/** The Tomatometer, whole-number and suffixed the way the roster UI shows it. */
export function formatRtScore(rtScore: number): string {
  return `${Math.round(rtScore)}% RT`
}

/**
 * A movie's score for display: the Tomatometer leads, fantasy points ride
 * along in parentheses. Falls back to points alone if a movie somehow has
 * points without an RT score.
 */
export function formatMovieScore(rtScore: number | null, points: number): string {
  if (rtScore === null) return `**${formatPoints(points)}** pts`
  return `**${formatRtScore(rtScore)}** (${formatPoints(points)} pts)`
}

/** Two scores are "the same" if they render identically. */
function pointsDiffer(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b
  return formatPoints(a) !== formatPoints(b)
}

/**
 * The smallest move worth a post: a movie's Tomatometer or fantasy points, or
 * a team's total. SCORING.md ("Change threshold") explains the value.
 */
export const SCORE_CHANGE_THRESHOLD = 3

/**
 * A score appearing or vanishing always counts. The slack is because decimal
 * scores can subtract to a hair under the threshold (4.1 - 1.1).
 */
function movedEnough(from: number | null, to: number | null): boolean {
  if (from === null || to === null) return from !== to
  return Math.abs(to - from) >= SCORE_CHANGE_THRESHOLD - 1e-9
}

/**
 * Whether a movie is far enough from the score last posted for it to post
 * again. Either number counts: above 90% one Tomatometer point is two fantasy
 * points, while below 30% RT moves barely touch points. A movie never posted
 * always qualifies; a withdrawn score never does.
 */
export function shouldAnnounceScore(
  announced: MovieScoreSnapshot,
  current: MovieScoreSnapshot
): boolean {
  return current.points !== null && (
    movedEnough(announced.points, current.points) ||
    movedEnough(announced.rtScore, current.rtScore)
  )
}

export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** Assigns competition ranks (1, 2, 2, 4) by descending points. */
export function rankStandings(
  teams: Array<{ teamId: string; teamName: string; points: number }>
): TeamStanding[] {
  const sorted = [...teams].sort(
    (a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName)
  )

  const ranked: TeamStanding[] = []
  let currentRank = 0
  let previousPoints: number | null = null

  for (const [index, team] of sorted.entries()) {
    if (previousPoints === null || team.points !== previousPoints) {
      currentRank = index + 1
      previousPoints = team.points
    }
    ranked.push({ ...team, rank: currentRank })
  }

  return ranked
}

// ============================================================================
// Diffing
// ============================================================================

/**
 * Compares before/after standings for one league.
 * Teams absent from the "before" snapshot are skipped -- they have no
 * meaningful movement to report.
 *
 * A rank change is always reported. A total that moved without changing rank
 * needs SCORE_CHANGE_THRESHOLD to be reported, the same bar a movie clears.
 * Once a team is listed, any visible move in its total shows alongside, since
 * that is what explains a rank change.
 */
export function diffStandings(
  before: TeamStanding[],
  after: TeamStanding[]
): StandingChange[] {
  const beforeByTeam = new Map(before.map((t) => [t.teamId, t]))
  const changes: StandingChange[] = []

  for (const current of after) {
    const previous = beforeByTeam.get(current.teamId)
    if (!previous) continue

    const pointsChanged = pointsDiffer(previous.points, current.points)
    const rankChanged = previous.rank !== current.rank
    if (!rankChanged && !movedEnough(previous.points, current.points)) continue

    changes.push({
      teamId: current.teamId,
      teamName: current.teamName,
      previousPoints: previous.points,
      newPoints: current.points,
      previousRank: previous.rank,
      newRank: current.rank,
      pointsChanged,
      rankChanged,
    })
  }

  // Report in final standings order so the message reads like the leaderboard
  return changes.sort((a, b) => a.newRank - b.newRank)
}

// ============================================================================
// Embed Builders
// ============================================================================

/**
 * Describes a team's total moving. Teams have no Tomatometer of their own, so
 * this stays fantasy points only -- see describeMovieScoreMovement for movies.
 */
function describeTeamScoreMovement(previous: number, next: number): string {
  const direction = next > previous ? 'UP' : 'DOWN'
  return `Score has gone **${direction}** from **${formatPoints(previous)}** to **${formatPoints(next)}**`
}

/**
 * Which way a movie moved. The Tomatometer decides whenever it moved at all:
 * in the flat tail of the curve points can tie at one decimal while RT --
 * the headline number -- clearly went one way.
 */
function movieScoreDirection(change: MovieScoreChange): 'UP' | 'DOWN' {
  const { previousRtScore, newRtScore } = change
  if (previousRtScore !== null && newRtScore !== null && newRtScore !== previousRtScore) {
    return newRtScore > previousRtScore ? 'UP' : 'DOWN'
  }
  return change.newPoints > (change.previousPoints as number) ? 'UP' : 'DOWN'
}

/** Same shape for a movie, with the Tomatometer leading on both sides. */
function describeMovieScoreMovement(change: MovieScoreChange): string {
  return (
    `Score has gone **${movieScoreDirection(change)}** from ` +
    `${formatMovieScore(change.previousRtScore, change.previousPoints as number)} to ` +
    `${formatMovieScore(change.newRtScore, change.newPoints)}`
  )
}

/** A release date the way Discord posts show one, e.g. "Oct 9". */
function formatReleaseDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
}

/** What a pre-release score adds: it is real, but it does not count yet. */
function describeCountsFromRelease(releaseDate: string | null): string {
  return releaseDate
    ? `Its points count once it releases on **${formatReleaseDate(releaseDate)}**`
    : 'Its points count once it releases'
}

/**
 * Release day for a score posted before release. If the score moved since
 * that post without clearing the threshold, the post says so, so the number
 * that now counts never contradicts the one posted earlier.
 */
function describeRelease(change: MovieScoreChange): string {
  const current = formatMovieScore(change.newRtScore, change.newPoints)
  const line = `Released: its ${current} now counts`
  if (change.previousPoints === null) return line

  const posted = formatMovieScore(change.previousRtScore, change.previousPoints)
  if (posted === current) return line
  const direction = movieScoreDirection(change) === 'UP' ? 'Up' : 'Down'
  return `${line}\n${direction} from ${posted} before release`
}

/** A first score, a move, or a release, plus the pre-release caveat if it applies. */
function describeMovieScore(change: MovieScoreChange): string {
  if (change.kind === 'release') return describeRelease(change)

  const line = change.kind === 'new'
    ? `Now has a score of ${formatMovieScore(change.newRtScore, change.newPoints)}`
    : describeMovieScoreMovement(change)
  return change.released ? line : `${line}\n${describeCountsFromRelease(change.releaseDate)}`
}

/** Blue for a first score, gold for a release, green or crimson for a move. */
function movieScoreColor(change: MovieScoreChange): number {
  if (change.kind === 'new') return DISCORD_COLORS.blue
  if (change.kind === 'release') return DISCORD_COLORS.gold
  return movieScoreDirection(change) === 'UP' ? DISCORD_COLORS.green : DISCORD_COLORS.crimson
}

export function buildMovieScoreEmbed(
  change: MovieScoreChange,
  placement: MoviePlacement,
  leagueName: string
): DiscordEmbed {
  const { leagueId } = placement

  const fields = [
    { name: 'Picked by', value: placement.ownerTeamName, inline: true },
  ]
  if (placement.counterpickerTeamName) {
    fields.push({
      name: 'Counterpicked by',
      value: placement.counterpickerTeamName,
      inline: true,
    })
  }

  return {
    author: buildEmbedAuthor(leagueName, leagueId),
    title: change.title,
    description: describeMovieScore(change),
    thumbnail: change.posterUrl
      ? { url: `https://image.tmdb.org/t/p/w92${change.posterUrl}` }
      : undefined,
    fields,
    color: movieScoreColor(change),
    footer: { text: leagueName },
    url: buildLeagueUrl(leagueId, '/standings'),
  }
}

export function buildStandingsEmbed(
  changes: StandingChange[],
  leagueName: string,
  leagueId: string
): DiscordEmbed {
  const shown = changes.slice(0, DISCORD_MAX_EMBED_FIELDS)

  const fields = shown.map((change) => {
    const lines: string[] = []
    if (change.pointsChanged) {
      lines.push(describeTeamScoreMovement(change.previousPoints, change.newPoints))
    }
    if (change.rankChanged) {
      lines.push(
        `Moved from **${ordinal(change.previousRank)}** place to **${ordinal(change.newRank)}** place`
      )
    }
    return { name: change.teamName, value: lines.join('\n'), inline: false }
  })

  const movers = changes.filter((c) => c.rankChanged).length
  const description = movers > 0
    ? `${changes.length} ${plural(changes.length, 'team')} updated, ${movers} changed position`
    : `${changes.length} ${plural(changes.length, 'team')} updated`

  const omitted = changes.length - shown.length
  const footer = omitted > 0
    ? `${leagueName} -- ${omitted} more not shown`
    : leagueName

  return {
    author: buildEmbedAuthor(leagueName, leagueId),
    title: 'Standings Update',
    description,
    fields,
    color: DISCORD_COLORS.blue,
    footer: { text: footer },
    url: buildLeagueUrl(leagueId, '/standings'),
  }
}

/**
 * Condenses the movies past the per-league cap into a single embed, so a busy
 * run stays informative without flooding the channel.
 */
export function buildMovieRollupEmbed(
  changes: MovieScoreChange[],
  leagueName: string,
  leagueId: string
): DiscordEmbed {
  const shown = changes.slice(0, DISCORD_MAX_EMBED_FIELDS)

  const fields = shown.map((change) => ({
    name: change.title,
    value: describeMovieScore(change),
    inline: false,
  }))

  const omitted = changes.length - shown.length

  return {
    author: buildEmbedAuthor(leagueName, leagueId),
    title: `${changes.length} more ${plural(changes.length, 'movie')} scored`,
    fields,
    color: DISCORD_COLORS.blue,
    footer: { text: omitted > 0 ? `${leagueName} -- ${omitted} more not shown` : leagueName },
    url: buildLeagueUrl(leagueId, '/standings'),
  }
}

/**
 * "Notable miss" (D2): a movie a team dropped that went on to score well.
 * Scoped to dropped movies only -- a never-drafted movie clearing this bar
 * would fire for every good release in every league, which isn't news.
 */
export const NOTABLE_MISS_THRESHOLD = 15
const NOTABLE_MISS_NOTIFICATION_TYPE = 'notable_miss'

/** True when points cross the notable-miss threshold from below. Unscored (null) counts as below. */
export function crossesNotableMissThreshold(previousPoints: number | null, newPoints: number): boolean {
  const previous = previousPoints ?? -Infinity
  return previous < NOTABLE_MISS_THRESHOLD && newPoints >= NOTABLE_MISS_THRESHOLD
}

export function buildNotableMissEmbed(
  change: MovieScoreChange,
  droppedByTeamName: string,
  leagueName: string,
  leagueId: string
): DiscordEmbed {
  return {
    author: buildEmbedAuthor(leagueName, leagueId),
    title: '👀 The one that got away',
    description: `**${change.title}** hit ${formatMovieScore(change.newRtScore, change.newPoints)} after **${droppedByTeamName}** dropped it`,
    thumbnail: change.posterUrl ? { url: `https://image.tmdb.org/t/p/w92${change.posterUrl}` } : undefined,
    color: DISCORD_COLORS.crimson,
    footer: { text: leagueName },
    url: buildLeagueUrl(leagueId, '/standings'),
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}

// ============================================================================
// Snapshot Loading
// ============================================================================

interface TeamRow {
  id: string
  name: string
  participant_id: string
}

/**
 * Reads current standings for the given leagues.
 * Teams with no team_scores row yet are included at 0 points.
 */
export async function snapshotStandings(
  supabase: SupabaseClient,
  leagueIds: string[]
): Promise<Map<string, TeamStanding[]>> {
  const standings = new Map<string, TeamStanding[]>()
  if (leagueIds.length === 0) return standings

  // Resolve league -> participants -> teams -> scores explicitly. Traversing
  // these one hop at a time avoids PostgREST embedded-filter ambiguity.
  const { data: participants, error: participantsError } = await supabase
    .from('league_participants')
    .select('id, league_id')
    .in('league_id', leagueIds)
    .eq('status', 'active')

  if (participantsError) {
    console.error('Failed to load league participants:', participantsError.message)
    return standings
  }
  if (!participants || participants.length === 0) return standings

  const leagueByParticipant = new Map<string, string>(
    participants.map((p: { id: string; league_id: string }) => [p.id, p.league_id])
  )

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, participant_id')
    .in('participant_id', [...leagueByParticipant.keys()])

  if (teamsError) {
    console.error('Failed to load teams:', teamsError.message)
    return standings
  }
  if (!teams || teams.length === 0) return standings

  const teamIds = (teams as TeamRow[]).map((t) => t.id)
  const { data: scores, error: scoresError } = await supabase
    .from('team_scores')
    .select('team_id, total_points')
    .in('team_id', teamIds)

  if (scoresError) {
    console.error('Failed to load team scores:', scoresError.message)
    return standings
  }

  const pointsByTeam = new Map<string, number>(
    (scores ?? []).map((s: { team_id: string; total_points: number | null }) => [
      s.team_id,
      Number(s.total_points ?? 0),
    ])
  )

  // Group into per-league buckets, then rank each independently
  const byLeague = new Map<string, Array<{ teamId: string; teamName: string; points: number }>>()
  for (const team of teams as TeamRow[]) {
    const leagueId = leagueByParticipant.get(team.participant_id)
    if (!leagueId) continue

    const bucket = byLeague.get(leagueId) ?? []
    bucket.push({
      teamId: team.id,
      teamName: team.name,
      points: pointsByTeam.get(team.id) ?? 0,
    })
    byLeague.set(leagueId, bucket)
  }

  for (const [leagueId, bucket] of byLeague) {
    standings.set(leagueId, rankStandings(bucket))
  }

  return standings
}

/** Shape shared by the draft_picks, pickups and counterpicks lookups. */
interface MovieTeamRow {
  movie_id: string
  league_id: string
  teams: { name: string } | { name: string }[] | null
}

interface HoldingRow extends MovieTeamRow {
  dropped_at: string | null
}

/** Normalizes PostgREST embeds, which type single rows as arrays. */
function firstOf<T>(value: T | T[] | null): T | null {
  if (value === null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

/** The two score columns, as PostgREST returns them. */
interface MovieScoreRow {
  id: string
  fantasy_points: number | null
  combined_score: number | null
}

/** Numeric columns can arrive as strings, so coerce before comparing. */
function toScoreSnapshot(points: number | null, rtScore: number | null): MovieScoreSnapshot {
  return {
    points: points === null ? null : Number(points),
    rtScore: rtScore === null ? null : Number(rtScore),
  }
}

/**
 * Captures the pre-update state needed to describe what changed.
 * Safe to call with an empty movie list.
 */
export async function captureScoreContext(
  supabase: SupabaseClient,
  movieIds: string[],
  today: string = utcDate()
): Promise<ScoreNotificationContext> {
  const empty: ScoreNotificationContext = {
    today,
    movieIds: [],
    leagueIds: [],
    previousMovieScores: new Map(),
    leagueNames: new Map(),
    previousStandings: new Map(),
    placements: [],
    droppedPlacements: [],
  }

  if (movieIds.length === 0) return empty

  try {
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, fantasy_points, combined_score')
      .in('id', movieIds)

    if (moviesError) {
      console.error('Failed to snapshot movie scores:', moviesError.message)
      return empty
    }

    const previousMovieScores = new Map<string, MovieScoreSnapshot>(
      (movies ?? []).map((m: MovieScoreRow) => [m.id, toScoreSnapshot(m.fantasy_points, m.combined_score)])
    )

    const holdings = await loadHoldings(supabase, movieIds)

    // League discovery is deliberately kept separate from movie attribution.
    // A dropped movie still counts toward its old owner's total_points (the
    // scoring RPC applies no dropped_at filter), so its league can legitimately
    // move in the standings even though we won't post a movie embed for it.
    // Keying the early return on placements instead of leagues would black out
    // the whole run's notifications in that case.
    const leagueIds = [...new Set(holdings.map((h) => h.placement.leagueId))]
    if (leagueIds.length === 0) return empty

    const placements = holdings.filter((h) => h.isActive).map((h) => h.placement)
    await attachCounterpickers(supabase, placements, movieIds)

    // Movies with no active holder in a league -- either genuinely dropped, or
    // superseded by an active row elsewhere in loadHoldings' dedup (see the
    // comment there). Candidates for the D2 "notable miss" notification.
    const droppedPlacements = holdings
      .filter((h) => !h.isActive)
      .map((h) => ({
        movieId: h.placement.movieId,
        leagueId: h.placement.leagueId,
        droppedByTeamName: h.placement.ownerTeamName,
      }))

    const [leagueNames, previousStandings] = await Promise.all([
      loadLeagueNames(supabase, leagueIds),
      snapshotStandings(supabase, leagueIds),
    ])

    return {
      today,
      movieIds,
      leagueIds,
      previousMovieScores,
      leagueNames,
      previousStandings,
      placements,
      droppedPlacements,
    }
  } catch (error) {
    console.error('Unexpected error capturing score context:', error)
    return empty
  }
}

interface Holding {
  placement: MoviePlacement
  /** False once dropped -- still scores for the owner, but isn't news. */
  isActive: boolean
}

/**
 * Loads every roster slot holding these movies, across both acquisition
 * paths: the draft (`draft_picks`) and the auction (`pickups`). The standings
 * page treats both as first-class roster entries, so notifications must too.
 *
 * Dropped rows are included but flagged inactive -- see captureScoreContext.
 * That is why this reads the base tables rather than the `team_holdings`
 * view: the view is active-only by design and exposes no dropped_at, so
 * routing this through it would silently empty droppedPlacements and kill
 * the notable-miss notification.
 */
async function loadHoldings(
  supabase: SupabaseClient,
  movieIds: string[]
): Promise<Holding[]> {
  const [picks, pickups] = await Promise.all([
    supabase
      .from('draft_picks')
      .select('movie_id, league_id, dropped_at, teams!draft_picks_team_id_fkey(name)')
      .in('movie_id', movieIds),
    supabase
      .from('pickups')
      .select('movie_id, league_id, dropped_at, teams!pickups_team_id_fkey(name)')
      .in('movie_id', movieIds),
  ])

  if (picks.error) {
    console.error('Failed to load draft picks for score notifications:', picks.error.message)
  }
  if (pickups.error) {
    console.error('Failed to load pickups for score notifications:', pickups.error.message)
  }

  const rows = [...(picks.data ?? []), ...(pickups.data ?? [])] as HoldingRow[]

  // One movie can occupy a slot in *both* tables for the same league: a movie
  // dropped from the draft becomes eligible for re-acquisition at auction
  // (is_movie_eligible_for_pickup excludes dropped draft picks), and drops are
  // soft, so the stale row lives on. Collapse to one holding per league,
  // always preferring the active row -- taking the dropped one would suppress
  // the movie embed for the team that actually holds the movie.
  const byKey = new Map<string, Holding>()

  for (const row of rows) {
    const key = `${row.movie_id}:${row.league_id}`
    const isActive = row.dropped_at === null

    const existing = byKey.get(key)
    if (existing && (existing.isActive || !isActive)) continue

    byKey.set(key, {
      isActive,
      placement: {
        movieId: row.movie_id,
        leagueId: row.league_id,
        ownerTeamName: firstOf(row.teams)?.name ?? 'A team',
        counterpickerTeamName: null,
      },
    })
  }

  return [...byKey.values()]
}

async function attachCounterpickers(
  supabase: SupabaseClient,
  placements: MoviePlacement[],
  movieIds: string[]
): Promise<void> {
  const { data: counterpicks, error } = await supabase
    .from('counterpicks')
    .select('movie_id, league_id, teams!counterpicks_counterpicker_team_id_fkey(name)')
    .in('movie_id', movieIds)

  if (error) {
    // Counterpicker attribution is decorative -- carry on without it
    console.error('Failed to load counterpicks for score notifications:', error.message)
    return
  }

  const byMovieAndLeague = new Map<string, string>()
  for (const row of (counterpicks ?? []) as MovieTeamRow[]) {
    const name = firstOf(row.teams)?.name
    if (name) byMovieAndLeague.set(`${row.movie_id}:${row.league_id}`, name)
  }

  for (const placement of placements) {
    placement.counterpickerTeamName =
      byMovieAndLeague.get(`${placement.movieId}:${placement.leagueId}`) ?? null
  }
}

async function loadLeagueNames(
  supabase: SupabaseClient,
  leagueIds: string[]
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('leagues')
    .select('id, name')
    .in('id', leagueIds)

  if (error) {
    console.error('Failed to load league names:', error.message)
    return new Map()
  }

  return new Map((data ?? []).map((l: { id: string; name: string }) => [l.id, l.name]))
}

// ============================================================================
// Notification Dispatch
// ============================================================================

/**
 * Per-league ceiling on individual movie messages in one run. Beyond this the
 * remainder is folded into a single rollup, so a heavy release weekend can't
 * dominate a channel.
 */
const MAX_MOVIE_EMBEDS_PER_LEAGUE = 8

/**
 * Counts what changed, not what was delivered -- a league with no enabled
 * Discord channel still shows up here. Delivery is logged by discord.ts.
 */
export interface ScoreNotificationSummary {
  movie_updates: number
  standings_updates: number
  leagues_with_changes: number
  notable_misses: number
}

/**
 * Sends "the one that got away" embeds for dropped movies that crossed the
 * notable-miss threshold this run. Idempotent per (league, movie) via
 * discord_notification_log, the same mechanism release-day-announcements
 * uses -- a rerun (or the movie scoring further past the threshold next
 * time) never resends. Never throws.
 */
async function sendNotableMissNotifications(
  supabase: SupabaseClient,
  context: ScoreNotificationContext,
  movieChanges: Map<string, MovieScoreChange>
): Promise<number> {
  const candidates = context.droppedPlacements
    .map((dropped) => ({ dropped, change: movieChanges.get(dropped.movieId) }))
    .filter(
      (c): c is { dropped: DroppedMoviePlacement; change: MovieScoreChange } =>
        c.change !== undefined && crossesNotableMissThreshold(c.change.previousPoints, c.change.newPoints)
    )

  if (candidates.length === 0) return 0

  try {
    const { data: alreadyLogged, error: logError } = await supabase
      .from('discord_notification_log')
      .select('league_id, movie_id')
      .eq('notification_type', NOTABLE_MISS_NOTIFICATION_TYPE)
      .in('movie_id', candidates.map((c) => c.dropped.movieId))

    if (logError) {
      console.error('Failed to check notable-miss notification log:', logError.message)
      return 0
    }

    const loggedKeys = new Set(
      (alreadyLogged ?? []).map((r: { league_id: string; movie_id: string }) => `${r.league_id}:${r.movie_id}`)
    )
    const unsent = candidates.filter((c) => !loggedKeys.has(`${c.dropped.leagueId}:${c.dropped.movieId}`))
    if (unsent.length === 0) return 0

    // Record before dispatching -- a rerun must not re-announce even if the
    // webhook delivery itself fails.
    const { error: insertError } = await supabase
      .from('discord_notification_log')
      .insert(
        unsent.map((c) => ({
          league_id: c.dropped.leagueId,
          movie_id: c.dropped.movieId,
          notification_type: NOTABLE_MISS_NOTIFICATION_TYPE,
        }))
      )

    if (insertError) {
      console.error('Failed to record notable-miss notification log:', insertError.message)
      return 0
    }

    for (const { dropped, change } of unsent) {
      const leagueName = context.leagueNames.get(dropped.leagueId) ?? 'League'
      await sendDiscordNotification(supabase, {
        leagueId: dropped.leagueId,
        category: 'movie_news',
        embeds: [buildNotableMissEmbed(change, dropped.droppedByTeamName, leagueName, dropped.leagueId)],
      })
      await delay(WEBHOOK_SEND_DELAY_MS)
    }

    return unsent.length
  } catch (error) {
    console.error('Unexpected error sending notable-miss notifications:', error)
    return 0
  }
}

/**
 * Posts one notification per movie due one (see shouldAnnounceScore) plus a
 * standings roundup for each league whose standings moved (see diffStandings).
 *
 * Never throws.
 */
export async function sendScoreNotifications(
  supabase: SupabaseClient,
  context: ScoreNotificationContext
): Promise<ScoreNotificationSummary> {
  const summary: ScoreNotificationSummary = {
    movie_updates: 0,
    standings_updates: 0,
    leagues_with_changes: 0,
    notable_misses: 0,
  }

  if (context.leagueIds.length === 0) return summary

  try {
    // A shared movie can keep scoring for another season after this snapshot
    // was taken. Recheck at dispatch so completed seasons stay quiet, including
    // the notable-miss path for movies their teams dropped.
    const { data: completedLeagues, error } = await supabase
      .from('leagues')
      .select('id')
      .in('id', context.leagueIds)
      .eq('status', COMPLETED_STATUS)

    if (error) {
      log.warn('Could not check completed seasons before score notifications', {
        error: serializeError(error),
      })
      return summary
    }

    const completedIds = new Set((completedLeagues ?? []).map((league: { id: string }) => league.id))
    context = {
      ...context,
      leagueIds: context.leagueIds.filter((id) => !completedIds.has(id)),
      placements: context.placements.filter((placement) => !completedIds.has(placement.leagueId)),
      droppedPlacements: context.droppedPlacements.filter((placement) => !completedIds.has(placement.leagueId)),
    }
    if (context.leagueIds.length === 0) return summary

    const { sinceSnapshot, toAnnounce } = await loadMovieScoreChanges(supabase, context)

    summary.notable_misses = await sendNotableMissNotifications(supabase, context, sinceSnapshot)

    const announcements = await recordAnnouncements(supabase, toAnnounce)

    const leagueIds = context.leagueIds
    const currentStandings = await snapshotStandings(supabase, leagueIds)

    // Build the per-league work list before sending so the summary is accurate
    const perLeague = leagueIds.map((leagueId) => {
      const leagueName = context.leagueNames.get(leagueId) ?? 'League'

      const changed = context.placements.filter(
        (p) => p.leagueId === leagueId && announcements.has(p.movieId)
      )

      const movieEmbeds = changed
        .slice(0, MAX_MOVIE_EMBEDS_PER_LEAGUE)
        .map((p) => buildMovieScoreEmbed(announcements.get(p.movieId)!, p, leagueName))

      // Fold anything past the cap into one rollup rather than dropping it
      const overflow = changed.slice(MAX_MOVIE_EMBEDS_PER_LEAGUE)
      if (overflow.length > 0) {
        movieEmbeds.push(
          buildMovieRollupEmbed(
            overflow.map((p) => announcements.get(p.movieId)!),
            leagueName,
            leagueId
          )
        )
      }

      const standingChanges = diffStandings(
        context.previousStandings.get(leagueId) ?? [],
        currentStandings.get(leagueId) ?? []
      )

      // Count movies, not messages -- the rollup stands in for many of them
      return { leagueId, leagueName, movieEmbeds, standingChanges, movieCount: changed.length }
    })

    for (const { movieCount, movieEmbeds, standingChanges } of perLeague) {
      if (movieEmbeds.length === 0 && standingChanges.length === 0) continue
      summary.movie_updates += movieCount
      if (standingChanges.length > 0) summary.standings_updates++
      summary.leagues_with_changes++
    }

    // Leagues use separate webhooks, so they can run concurrently; messages
    // within a league are sequenced to stay under the per-webhook rate limit.
    await Promise.allSettled(
      perLeague.map(async ({ leagueId, leagueName, movieEmbeds, standingChanges }) => {
        for (const embed of movieEmbeds) {
          await sendDiscordNotification(supabase, {
            leagueId,
            category: 'scores',
            embeds: [embed],
          })
          await delay(WEBHOOK_SEND_DELAY_MS)
        }

        if (standingChanges.length > 0) {
          await sendDiscordNotification(supabase, {
            leagueId,
            category: 'scores',
            embeds: [buildStandingsEmbed(standingChanges, leagueName, leagueId)],
          })
        }
      })
    )

    return summary
  } catch (error) {
    console.error('Unexpected error sending score notifications:', error)
    return summary
  }
}

interface MovieRow extends MovieScoreRow {
  title: string
  poster_url: string | null
  release_date: string | null
  announced_fantasy_points: number | null
  announced_rt_score: number | null
  announced_before_release: boolean
}

const UNSCORED: MovieScoreSnapshot = { points: null, rtScore: null }

/** One run's movie scores, measured from two starting points. */
interface MovieScoreChanges {
  /**
   * Point moves since the pre-run snapshot. Notable-miss detection reads
   * these: a dropped movie can cross its bar on a step too small to post.
   */
  sinceSnapshot: Map<string, MovieScoreChange>
  /** Movies due a post, described from the score last posted for them. */
  toAnnounce: MovieScoreChange[]
}

async function loadMovieScoreChanges(
  supabase: SupabaseClient,
  context: ScoreNotificationContext
): Promise<MovieScoreChanges> {
  const result: MovieScoreChanges = { sinceSnapshot: new Map(), toAnnounce: [] }

  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title, poster_url, release_date, fantasy_points, combined_score, announced_fantasy_points, announced_rt_score, announced_before_release')
    .in('id', context.movieIds)

  if (error) {
    console.error('Failed to load updated movie scores:', error.message)
    return result
  }

  for (const movie of (movies ?? []) as MovieRow[]) {
    const current = toScoreSnapshot(movie.fantasy_points, movie.combined_score)
    if (current.points === null) continue
    const newPoints = current.points
    const released = hasReleased(movie.release_date, context.today)

    const describeFrom = (
      previous: MovieScoreSnapshot,
      kind: MovieScoreChangeKind = previous.points === null ? 'new' : 'moved'
    ): MovieScoreChange => ({
      movieId: movie.id,
      title: movie.title,
      posterUrl: movie.poster_url,
      previousPoints: previous.points,
      newPoints,
      previousRtScore: previous.rtScore,
      newRtScore: current.rtScore,
      kind,
      released,
      releaseDate: movie.release_date,
    })

    const previous = context.previousMovieScores.get(movie.id) ?? UNSCORED
    if (pointsDiffer(previous.points, current.points)) {
      result.sinceSnapshot.set(movie.id, describeFrom(previous))
    }

    const announced = toScoreSnapshot(movie.announced_fantasy_points, movie.announced_rt_score)
    if (released && movie.announced_before_release) {
      // The last post said these points would count from release day. They
      // count now, whatever the size of any move since.
      result.toAnnounce.push(describeFrom(announced, 'release'))
    } else if (shouldAnnounceScore(announced, current)) {
      result.toAnnounce.push(describeFrom(announced))
    }
  }

  return result
}

/**
 * Moves each movie's announced score (`movies.announced_*`) to the score about
 * to be posted, noting whether it is posted before release (which leaves the
 * release itself due a post). Recording before posting means a failed write
 * can never post the same move twice: a movie whose write fails is left out
 * of this run, and because it is still as far from its old announced score,
 * the next run posts it instead.
 */
async function recordAnnouncements(
  supabase: SupabaseClient,
  changes: MovieScoreChange[]
): Promise<Map<string, MovieScoreChange>> {
  const recorded = new Map<string, MovieScoreChange>()

  await Promise.all(
    changes.map(async (change) => {
      const { error } = await supabase
        .from('movies')
        .update({
          announced_fantasy_points: change.newPoints,
          announced_rt_score: change.newRtScore,
          announced_before_release: !change.released,
        })
        .eq('id', change.movieId)

      if (error) {
        log.warn('Could not record announced movie score; its post waits for the next run', {
          movie_id: change.movieId,
          error: serializeError(error),
        })
        return
      }
      recorded.set(change.movieId, change)
    })
  )

  return recorded
}
