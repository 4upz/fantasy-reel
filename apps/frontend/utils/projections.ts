import type { MovieProjection } from '@/types'

/**
 * Projected scores (Beta): how a projection reads on screen.
 *
 * A chip carries ONE number, in the same unit as the real score that replaces
 * it on release day: the Tomatometer. Points, odds and the factor breakdown
 * live in the breakdown, a tap away.
 */

/** Points are RT - 60, so 60 is where a projection turns from earning to losing. */
export const PROJECTION_BREAK_EVEN = 60

/** A middle-50% range wider than this is no help as a range; show the point estimate instead. */
export const MAX_RANGE_WIDTH = 10

/** The one copy of the Beta caveat. Every surface that explains projections uses it. */
export const PROJECTION_DISCLAIMER =
  'Projections are a Beta estimate from genre, filmmakers, cast and franchise history. They never count toward your total.'

export const RANGE_EXPLAINER =
  'The range is the middle half of likely outcomes: about half of real scores should land inside it.'

export type ProjectionChipState =
  | { kind: 'early'; score: number; reviews: number }
  | { kind: 'insufficient' }
  | { kind: 'range'; low: number; high: number }
  | { kind: 'point'; value: number; lowConfidence: boolean }

/**
 * Which of the chip's states a projection is in. Early reviews win: a real,
 * if young, Tomatometer says more than any model. Then "not enough history",
 * which shows no number at all. Otherwise a tight range, falling back to the
 * point estimate when the range is too wide to be worth reading.
 */
export function projectionChipState(projection: MovieProjection): ProjectionChipState {
  if (projection.early_rt) {
    return { kind: 'early', score: Math.round(projection.early_rt.score), reviews: projection.early_rt.reviews }
  }
  if (projection.insufficient_history) return { kind: 'insufficient' }
  const [low, high] = projection.range50
  const wide = projection.low_confidence || high - low > MAX_RANGE_WIDTH
  const roundedLow = Math.round(low)
  const roundedHigh = Math.round(high)
  if (wide || roundedLow === roundedHigh) {
    return { kind: 'point', value: Math.round(projection.projected_rt), lowConfidence: wide }
  }
  return { kind: 'range', low: roundedLow, high: roundedHigh }
}

/** The chip's words: "Proj. 68–79%", "Proj. 74%", "Early RT 88% (24 reviews)". */
export function projectionChipLabel(state: ProjectionChipState): string {
  switch (state.kind) {
    case 'early':
      return `Early RT ${state.score}% (${state.reviews} ${state.reviews === 1 ? 'review' : 'reviews'})`
    case 'insufficient':
      return 'Not enough history yet'
    case 'range':
      return `Proj. ${state.low}–${state.high}%`
    case 'point':
      return `Proj. ${state.value}%`
  }
}

export type ProjectionTone = 'fresh' | 'rotten' | 'uncertain'

/** Gold above break-even, crimson below, neutral when the number is a loose guess. */
export function projectionTone(
  projection: MovieProjection,
  state: ProjectionChipState = projectionChipState(projection)
): ProjectionTone {
  if (state.kind === 'insufficient' || (state.kind === 'point' && state.lowConfidence)) return 'uncertain'
  const score = state.kind === 'early' ? state.score : projection.projected_rt
  return score >= PROJECTION_BREAK_EVEN ? 'fresh' : 'rotten'
}

/** The expected points a holder scores: a counterpick scores the movie's negation. */
export function projectedPointsFor(projection: MovieProjection, counterpick = false): number {
  return counterpick ? -projection.expected_points : projection.expected_points
}

/** "12%" for a 0..1 probability. Never "0%" or "100%" -- a projection is never certain. */
export function formatChance(probability: number): string {
  const percent = Math.round(probability * 100)
  if (percent <= 0) return '<1%'
  if (percent >= 100) return '>99%'
  return `${percent}%`
}

/** "Oct 6" from an ISO timestamp, in UTC like release dates. */
export function formatProjectionDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** How many factors the breakdown names before folding the rest into one line. */
const MAX_NAMED_FACTORS = 5

export interface ProjectionFactor {
  key: string
  label: string
  delta: number
}

/**
 * The contributions the breakdown lists: largest first, with the long tail
 * folded into "Other factors" so the legend stays readable on a phone.
 */
export function projectionFactors(projection: MovieProjection): ProjectionFactor[] {
  const sorted = projection.contributions
    .filter((contribution) => Math.abs(contribution.delta_rt) >= 0.05)
    .map((contribution) => ({ key: contribution.factor, label: contribution.label, delta: contribution.delta_rt }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  if (sorted.length <= MAX_NAMED_FACTORS) return sorted
  const named = sorted.slice(0, MAX_NAMED_FACTORS - 1)
  const rest = sorted.slice(MAX_NAMED_FACTORS - 1).reduce((sum, factor) => sum + factor.delta, 0)
  return [...named, { key: 'other', label: 'Other factors', delta: rest }]
}

export interface BarSegment {
  key: string
  /** Percent of the 0-100 bar. */
  start: number
  width: number
  positive: boolean
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

/**
 * The stacked bar: the genre baseline as one block from 0, then each factor
 * walking the total up (gold) or back down (crimson) from where the last left
 * it, so the bar ends at the projection.
 */
export function projectionBarSegments(baseline: number, factors: ProjectionFactor[]): BarSegment[] {
  const segments: BarSegment[] = [{ key: 'baseline', start: 0, width: clampPercent(baseline), positive: true }]
  let cursor = baseline
  for (const factor of factors) {
    const next = cursor + factor.delta
    const start = clampPercent(Math.min(cursor, next))
    const width = clampPercent(Math.max(cursor, next)) - start
    if (width > 0) segments.push({ key: factor.key, start, width, positive: factor.delta >= 0 })
    cursor = next
  }
  return segments
}

