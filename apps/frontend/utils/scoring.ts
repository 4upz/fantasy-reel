import { formatReleaseDateShort, hasReleased } from '@/utils/date'

/**
 * Fantasy points display helpers.
 *
 * Points come from the RT-only curve and can be negative. Colour carries the
 * sign - gold for positive, crimson for negative - so a positive value renders
 * bare ("37") and only negatives keep their marker ("-16"). `combined_score` is
 * the Tomatometer itself, not points - never render it with a "pts" suffix.
 *
 * A movie can be scored before it opens, but its points only count toward team
 * totals from release day. Until then it is a pre-release score: still shown,
 * but muted, never in the colours that mean "counted".
 */

/** Whole-number fantasy points (e.g. "36", "-16"). Unscored renders as "--". */
export function formatFantasyPoints(points: number | null | undefined): string {
  if (points == null) return '--'
  return String(Math.round(points))
}

/**
 * Whether `points` is a pre-release score: the movie has one but has not
 * released, so it does not count toward team totals yet. For a counterpick,
 * pass the counterpicked movie's release date.
 */
export function isPreReleaseScore(
  points: number | null | undefined,
  releaseDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  return points != null && !hasReleased(releaseDate, now)
}

/** Inline points copy: "24 pts" once they count, "24 pts at release" before. */
export function formatPointsText(points: number, preRelease: boolean): string {
  return `${formatFantasyPoints(points)} pts${preRelease ? ' at release' : ''}`
}

/**
 * The text colour for a points value. Counted points take `positive` (success
 * green; surfaces that show totals in gold pass that) or crimson; no score and
 * a pre-release score are muted, because those two colours mean "counted".
 */
export function pointsTone(
  points: number | null | undefined,
  { preRelease = false, positive = 'text-success' }: { preRelease?: boolean; positive?: string } = {}
): string {
  if (points == null || preRelease) return 'text-foreground-secondary'
  return points >= 0 ? positive : 'text-crimson-text'
}

/**
 * Whether a movie is locked against bids and trades: once it has a score its
 * outcome is known, so it no longer changes hands, released or not. The server
 * enforces this; the UI says so up front instead of letting a request fail.
 * Pass the movie's points -- or a counterpick's, which are the movie's
 * inverted and so set exactly when it is scored.
 */
export function isScoreLocked(points: number | null | undefined): boolean {
  return points != null
}

/** Why a pre-release score is muted, for a tooltip or screen reader where there is no room to say it. */
export function describePreReleaseScore(releaseDate: string | null | undefined): string {
  return releaseDate
    ? `Pre-release score — counts once it releases on ${formatReleaseDateShort(releaseDate)}`
    : 'Pre-release score — counts once it releases'
}

/**
 * Fantasy points a Tomatometer would earn, on the same curve as
 * `calculate_movie_score()` in the database (see CLAUDE.md, Scoring System):
 * 1 point per point from 50 up. Pass the season's `double_points_over_90` to
 * add its 90+ bonus, as `league_fantasy_points()` does. For projections only
 * -- real points always come from the server.
 */
export function fantasyPointsForTomatometer(rt: number, doublePointsOver90 = false): number {
  let points: number
  if (rt >= 50) points = rt - 60
  else if (rt >= 40) points = -10 - (50 - rt) * 0.5
  else if (rt >= 30) points = -15 - (40 - rt) * 0.25
  else if (rt >= 20) points = -17.5 - (30 - rt) * 0.125
  else if (rt >= 10) points = -18.75 - (20 - rt) * 0.0625
  else points = -19.375 - (10 - rt) * 0.03125
  return leagueFantasyPoints(Math.round(points * 100) / 100, rt, doublePointsOver90)
}

/**
 * A movie's fantasy points in one season, mirroring `league_fantasy_points()`
 * in the database: the stored default-rule points, plus (RT - 90) above 90
 * when the season pays double points. Only raw `movies` rows need this --
 * `team_holdings` and `counterpicks` rows already carry their season's points.
 * Pending (null) points are the caller's to keep null.
 */
export function leagueFantasyPoints(
  points: number,
  rtScore: number | null,
  doublePointsOver90: boolean
): number {
  return doublePointsOver90 && rtScore !== null && rtScore > 90 ? points + (rtScore - 90) : points
}

/** A projected value with its sign spelled out ("+9", "-16", "0"). */
export function formatSignedPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

/** The critic score of record, shown as context alongside points (e.g. "93% RT"). */
export function formatCriticScore(combinedScore: number): string {
  return `${Math.round(combinedScore)}% RT`
}
