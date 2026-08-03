/**
 * Fantasy points display helpers.
 *
 * Points come from the RT-only curve and can be negative, so they always render
 * with an explicit sign. `combined_score` is the Tomatometer itself, not points
 * - never render it with a "pts" suffix.
 */

/** Signed, whole-number fantasy points (e.g. "+36", "-16"). */
export function formatFantasyPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

/** The critic score of record, shown as context alongside points (e.g. "93% RT"). */
export function formatCriticScore(combinedScore: number): string {
  return `${Math.round(combinedScore)}% RT`
}
