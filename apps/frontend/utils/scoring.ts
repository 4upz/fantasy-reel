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

/** The critic score of record, shown as context alongside points (e.g. "93% RT"). */
export function formatCriticScore(combinedScore: number): string {
  return `${Math.round(combinedScore)}% RT`
}
