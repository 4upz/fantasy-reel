/**
 * Fantasy points display helpers.
 *
 * Points come from the RT-only curve and can be negative. Colour carries the
 * sign - gold for positive, crimson for negative - so a positive value renders
 * bare ("37") and only negatives keep their marker ("-16"). `combined_score` is
 * the Tomatometer itself, not points - never render it with a "pts" suffix.
 */

/** Whole-number fantasy points (e.g. "36", "-16"). Unscored renders as "--". */
export function formatFantasyPoints(points: number | null | undefined): string {
  if (points == null) return '--'
  return String(Math.round(points))
}

/**
 * Fantasy points a Tomatometer would earn, on the same curve as
 * `calculate_movie_score()` in the database (see CLAUDE.md, Scoring System).
 * For projections only -- real points always come from the server.
 */
export function fantasyPointsForTomatometer(rt: number): number {
  let points: number
  if (rt >= 90) points = 30 + (rt - 90) * 2
  else if (rt >= 50) points = rt - 60
  else if (rt >= 40) points = -10 - (50 - rt) * 0.5
  else if (rt >= 30) points = -15 - (40 - rt) * 0.25
  else if (rt >= 20) points = -17.5 - (30 - rt) * 0.125
  else if (rt >= 10) points = -18.75 - (20 - rt) * 0.0625
  else points = -19.375 - (10 - rt) * 0.03125
  return Math.round(points * 100) / 100
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
