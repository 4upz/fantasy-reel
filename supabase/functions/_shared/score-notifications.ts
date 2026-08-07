/**
 * Score notification utilities.
 *
 * Detects what changed during a score update run and emits Discord
 * notifications for three events:
 *   1. A movie receives its first score, or its score moves up/down.
 *   2. A team's total score changes because one of its movies scored.
 *   3. A team's rank in the league standings changes.
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
import {
  sendDiscordNotification,
  DISCORD_COLORS,
  buildLeagueUrl,
  buildEmbedAuthor,
  type DiscordEmbed,
} from './discord.ts'

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

/** Snapshot taken before scores are recalculated. */
export interface ScoreNotificationContext {
  movieIds: string[]
  /** Leagues holding these movies, including via dropped roster slots. */
  leagueIds: string[]
  /** movieId -> fantasy_points before the update (null = unscored). */
  previousMoviePoints: Map<string, number | null>
  /** leagueId -> league name. */
  leagueNames: Map<string, string>
  /** leagueId -> standings before the update. */
  previousStandings: Map<string, TeamStanding[]>
  placements: MoviePlacement[]
  /** Movies with no active roster holder in a league, for notable-miss detection. */
  droppedPlacements: DroppedMoviePlacement[]
}

/** A movie whose displayed score changed. */
export interface MovieScoreChange {
  movieId: string
  title: string
  posterUrl: string | null
  previousPoints: number | null
  newPoints: number
  /** True when the movie had no score before -- it just went live. */
  isNewScore: boolean
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

/** Two scores are "the same" if they render identically. */
function pointsDiffer(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b
  return formatPoints(a) !== formatPoints(b)
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
    if (!pointsChanged && !rankChanged) continue

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

/** Describes a score movement the way the standings page phrases it. */
function describeScoreMovement(previous: number, next: number): string {
  const direction = next > previous ? 'UP' : 'DOWN'
  return `Score has gone **${direction}** from **${formatPoints(previous)}** to **${formatPoints(next)}**`
}

export function buildMovieScoreEmbed(
  change: MovieScoreChange,
  placement: MoviePlacement,
  leagueName: string
): DiscordEmbed {
  const { leagueId } = placement

  const description = change.isNewScore
    ? `Now has a score of **${formatPoints(change.newPoints)}**`
    : describeScoreMovement(change.previousPoints as number, change.newPoints)

  let color: number = DISCORD_COLORS.blue
  if (!change.isNewScore) {
    color = change.newPoints > (change.previousPoints as number)
      ? DISCORD_COLORS.green
      : DISCORD_COLORS.crimson
  }

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
    description,
    thumbnail: change.posterUrl
      ? { url: `https://image.tmdb.org/t/p/w92${change.posterUrl}` }
      : undefined,
    fields,
    color,
    footer: { text: leagueName },
    url: buildLeagueUrl(leagueId, '/standings'),
  }
}

/** Discord allows at most 25 fields per embed. */
const MAX_EMBED_FIELDS = 25

export function buildStandingsEmbed(
  changes: StandingChange[],
  leagueName: string,
  leagueId: string
): DiscordEmbed {
  const shown = changes.slice(0, MAX_EMBED_FIELDS)

  const fields = shown.map((change) => {
    const lines: string[] = []
    if (change.pointsChanged) {
      lines.push(describeScoreMovement(change.previousPoints, change.newPoints))
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
  const shown = changes.slice(0, MAX_EMBED_FIELDS)

  const fields = shown.map((change) => ({
    name: change.title,
    value: change.isNewScore
      ? `Now has a score of **${formatPoints(change.newPoints)}**`
      : describeScoreMovement(change.previousPoints as number, change.newPoints),
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
    description: `**${change.title}** hit **${formatPoints(change.newPoints)}** pts after **${droppedByTeamName}** dropped it`,
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

/**
 * Captures the pre-update state needed to describe what changed.
 * Safe to call with an empty movie list.
 */
export async function captureScoreContext(
  supabase: SupabaseClient,
  movieIds: string[]
): Promise<ScoreNotificationContext> {
  const empty: ScoreNotificationContext = {
    movieIds: [],
    leagueIds: [],
    previousMoviePoints: new Map(),
    leagueNames: new Map(),
    previousStandings: new Map(),
    placements: [],
    droppedPlacements: [],
  }

  if (movieIds.length === 0) return empty

  try {
    const { data: movies, error: moviesError } = await supabase
      .from('movies')
      .select('id, fantasy_points')
      .in('id', movieIds)

    if (moviesError) {
      console.error('Failed to snapshot movie scores:', moviesError.message)
      return empty
    }

    const previousMoviePoints = new Map<string, number | null>(
      (movies ?? []).map((m: { id: string; fantasy_points: number | null }) => [
        m.id,
        m.fantasy_points === null ? null : Number(m.fantasy_points),
      ])
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
      movieIds,
      leagueIds,
      previousMoviePoints,
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
 * Spacing between messages to the same webhook. Discord's per-webhook bucket
 * is 5 requests per 2s (400ms); this leaves a margin on top. Overrunning it
 * can still cost a message -- discord.ts retries a 429 once, honouring
 * retry_after (capped at 5s), but a failure on that retry is dropped like
 * any other webhook error.
 */
const WEBHOOK_SEND_DELAY_MS = 450

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
 * Compares current state against the captured snapshot and posts one
 * notification per changed movie plus one standings roundup per league.
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
    const movieChanges = await loadMovieScoreChanges(supabase, context)

    summary.notable_misses = await sendNotableMissNotifications(supabase, context, movieChanges)

    const leagueIds = context.leagueIds
    const currentStandings = await snapshotStandings(supabase, leagueIds)

    // Build the per-league work list before sending so the summary is accurate
    const perLeague = leagueIds.map((leagueId) => {
      const leagueName = context.leagueNames.get(leagueId) ?? 'League'

      const changed = context.placements.filter(
        (p) => p.leagueId === leagueId && movieChanges.has(p.movieId)
      )

      const movieEmbeds = changed
        .slice(0, MAX_MOVIE_EMBEDS_PER_LEAGUE)
        .map((p) => buildMovieScoreEmbed(movieChanges.get(p.movieId)!, p, leagueName))

      // Fold anything past the cap into one rollup rather than dropping it
      const overflow = changed.slice(MAX_MOVIE_EMBEDS_PER_LEAGUE)
      if (overflow.length > 0) {
        movieEmbeds.push(
          buildMovieRollupEmbed(
            overflow.map((p) => movieChanges.get(p.movieId)!),
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

interface MovieRow {
  id: string
  title: string
  poster_url: string | null
  fantasy_points: number | null
}

/** Returns only movies whose displayed score actually moved. */
async function loadMovieScoreChanges(
  supabase: SupabaseClient,
  context: ScoreNotificationContext
): Promise<Map<string, MovieScoreChange>> {
  const changes = new Map<string, MovieScoreChange>()

  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title, poster_url, fantasy_points')
    .in('id', context.movieIds)

  if (error) {
    console.error('Failed to load updated movie scores:', error.message)
    return changes
  }

  for (const movie of (movies ?? []) as MovieRow[]) {
    if (movie.fantasy_points === null) continue

    const newPoints = Number(movie.fantasy_points)
    const previousPoints = context.previousMoviePoints.get(movie.id) ?? null

    if (!pointsDiffer(previousPoints, newPoints)) continue

    changes.set(movie.id, {
      movieId: movie.id,
      title: movie.title,
      posterUrl: movie.poster_url,
      previousPoints,
      newPoints,
      isNewScore: previousPoints === null,
    })
  }

  return changes
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
