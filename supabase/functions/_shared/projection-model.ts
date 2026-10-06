/**
 * The projection model: a ridge regression on the logit of the Tomatometer,
 * starting from a genre baseline and adding shrunk track-record deviations and
 * plain pre-release features (see `projection-features.ts`), with calibrated
 * ranges and probabilities from forward-chaining backtest residuals.
 *
 *   z = b + a + sum_j c_j x_j          (logit scale; b = genre baseline)
 *   projected RT = 100 * sigmoid(z)
 *
 * Uncertainty is split-conformal: residuals z_actual - z from fits that never
 * saw the year they predicted, grouped by coverage band. Ranges are residual
 * quantiles with the finite-sample correction; P(rotten), P(fresh), P(90+) and
 * expected points (both scoring rules) sum the same residual distribution over
 * 1-point RT bins. Early reviews update it as a Beta prior.
 *
 * Pure -- no Supabase calls, no I/O -- like `bid-resolution.ts`: the fit cron
 * and get-movie-projections are meant to be thin wrappers that load rows and
 * store what these functions return.
 */

import { fantasyPointsForTomatometer } from './fantasy-points.ts'
import {
  type CorpusIndex,
  coverage,
  DAY_MS,
  dayNumber,
  DEFAULT_SHRINKAGE,
  effectiveUsDate,
  FEATURE_KEYS,
  FEATURE_SPECS,
  featureVector,
  groupLabel,
  logit,
  logitToRt,
  type RawFeatures,
  rawFeatures,
  rtToLogit,
  type Shrinkage,
  SHRUNK_FACTORS,
} from './projection-features.ts'
import type { CorpusFilm, MovieProjection, ProjectionContribution } from './projection-types.ts'
import { DEFAULT_RIDGE_LAMBDAS, fitRidge, type PenaltySearchResult, searchRidgePenalty } from './ridge.ts'

// ---------------------------------------------------------------------------
// Training rows
// ---------------------------------------------------------------------------

/** One labelled film, ready to fit or score. */
export interface ModelRow {
  raw: RawFeatures
  /** Logit target (smoothed share). */
  target: number
  /** Final Tomatometer 0-100. */
  rt: number
  /** Effective US release year. */
  year: number
  day: number
}

export interface TrainingRowOptions {
  /** Only films whose label has settled (`rt_settled_at`) -- default true. */
  requireSettled?: boolean
  /** Build features as of this many days before release (default 0). */
  leadDays?: number
}

/** Labelled films as model rows. Undated or unscored films are skipped. */
export function trainingRows(
  index: CorpusIndex,
  films: readonly CorpusFilm[],
  options: TrainingRowOptions = {},
): ModelRow[] {
  const requireSettled = options.requireSettled ?? true
  const leadDays = options.leadDays ?? 0
  const rows: ModelRow[] = []
  for (const film of films) {
    const date = effectiveUsDate(film)
    if (film.rt_critic == null || !date || (requireSettled && !film.rt_settled_at)) continue
    const day = dayNumber(date)
    rows.push({
      raw: rawFeatures(index, film, { asOfDay: day - leadDays }),
      target: rtToLogit(film.rt_critic, film.rt_critic_votes),
      rt: film.rt_critic,
      year: new Date(day * DAY_MS).getUTCFullYear(),
      day,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Regression fit
// ---------------------------------------------------------------------------

/** What a prediction needs: shrinkage for the features, then the ridge terms. */
export interface Regression {
  shrinkage: Shrinkage
  intercept: number
  /** One per `FEATURE_KEYS` entry, original scale. */
  coefficients: number[]
  lambda: number
}

export interface FitOptions {
  lambdas?: readonly number[]
  /** Candidate k per shrunk factor. */
  shrinkageGrid?: readonly number[]
  /** Choose each factor's k by inner validation (default true); otherwise keep the starting k. */
  searchShrinkage?: boolean
  /** Starting k per shrunk factor (default DEFAULT_SHRINKAGE), e.g. a previous model's. */
  shrinkage?: Shrinkage
  innerFolds?: number
  minTrainFraction?: number
}

export const DEFAULT_SHRINKAGE_GRID: readonly number[] = [1, 2, 3, 5, 8, 13]

/** The design matrix: features, and the target as a deviation from the genre baseline. */
export function designMatrix(rows: readonly ModelRow[], shrinkage: Shrinkage) {
  return {
    X: rows.map((r) => featureVector(r.raw, shrinkage)),
    y: rows.map((r) => r.target - r.raw.baseline),
    times: rows.map((r) => r.day),
  }
}

/**
 * Fits the regression. The penalty is chosen by time-ordered inner
 * validation; then each factor's shrinkage k is chosen by coordinate search
 * at that penalty (one pass over `SHRUNK_FACTORS`), and the penalty is chosen
 * again for the final k.
 */
export function fitRegression(rows: readonly ModelRow[], options: FitOptions = {}): Regression & { search: PenaltySearchResult } {
  if (rows.length === 0) throw new Error('projection model: no training rows')
  const lambdas = options.lambdas ?? DEFAULT_RIDGE_LAMBDAS
  const searchOptions = { folds: options.innerFolds ?? 3, minTrainFraction: options.minTrainFraction ?? 0.5 }
  const validate = (shrinkage: Shrinkage, candidates: readonly number[]) => {
    const { X, y, times } = designMatrix(rows, shrinkage)
    return searchRidgePenalty(X, y, times, { ...searchOptions, lambdas: candidates })
  }
  const mseAt = (result: PenaltySearchResult) => result.scores.find((s) => s.lambda === result.lambda)!.mse

  let shrinkage: Shrinkage = { ...(options.shrinkage ?? DEFAULT_SHRINKAGE) }
  let search = validate(shrinkage, lambdas)
  if ((options.searchShrinkage ?? true) && Number.isFinite(mseAt(search))) {
    let best = mseAt(search)
    for (const factor of SHRUNK_FACTORS) {
      for (const k of options.shrinkageGrid ?? DEFAULT_SHRINKAGE_GRID) {
        if (k === shrinkage[factor]) continue
        const candidate = { ...shrinkage, [factor]: k }
        const mse = validate(candidate, [search.lambda]).scores[0].mse
        if (mse < best - 1e-12) {
          best = mse
          shrinkage = candidate
        }
      }
    }
    search = validate(shrinkage, lambdas)
  }
  const { X, y } = designMatrix(rows, shrinkage)
  const ridge = fitRidge(X, y, search.lambda)
  return { shrinkage, intercept: ridge.intercept, coefficients: ridge.coefficients, lambda: ridge.lambda, search }
}

export interface LogitPrediction {
  /** Projected logit. */
  z: number
  /** Genre baseline plus intercept: the projection with every term removed. */
  baselineZ: number
  /** Each feature's term c_j * x_j, in `FEATURE_KEYS` order. */
  terms: number[]
}

export function predictLogit(regression: Regression, raw: RawFeatures): LogitPrediction {
  const x = featureVector(raw, regression.shrinkage)
  const terms = x.map((v, j) => regression.coefficients[j] * v)
  const baselineZ = raw.baseline + regression.intercept
  return { z: baselineZ + terms.reduce((a, b) => a + b, 0), baselineZ, terms }
}

// ---------------------------------------------------------------------------
// Forward chaining
// ---------------------------------------------------------------------------

export interface ChainPrediction {
  row: ModelRow
  prediction: LogitPrediction
  coverage: number
  /** target - z, logit scale. */
  residual: number
}

export interface ChainOptions extends FitOptions {
  /** Skip a year whose training set is smaller than this (default 50). */
  minTrainRows?: number
}

/**
 * For each year Y: fit on every row released before 1 January of Y, predict
 * Y. Features already use only earlier films, so nothing from the future
 * leaks in.
 */
export function forwardChain(
  rows: readonly ModelRow[],
  years: readonly number[],
  options: ChainOptions = {},
): { predictions: ChainPrediction[]; fits: Map<number, Regression & { search: PenaltySearchResult }> } {
  const predictions: ChainPrediction[] = []
  const fits = new Map<number, Regression & { search: PenaltySearchResult }>()
  for (const year of [...years].sort((a, b) => a - b)) {
    const train = rows.filter((r) => r.year < year)
    const test = rows.filter((r) => r.year === year)
    if (test.length === 0 || train.length < (options.minTrainRows ?? 50)) continue
    const fit = fitRegression(train, options)
    fits.set(year, fit)
    for (const row of test) {
      const prediction = predictLogit(fit, row.raw)
      predictions.push({ row, prediction, coverage: coverage(row.raw, fit.shrinkage), residual: row.target - prediction.z })
    }
  }
  return { predictions, fits }
}

// ---------------------------------------------------------------------------
// Conformal calibration
// ---------------------------------------------------------------------------

/** Residuals of one coverage band, summarized as evenly spaced quantiles. */
export interface ResidualBand {
  /** Inclusive lower coverage edge; the band runs to the next band's edge. */
  min_coverage: number
  /** Residuals behind the summary, for the finite-sample correction. */
  n: number
  /** Sorted quantiles at probabilities (i + 0.5) / length. */
  quantiles: number[]
}

export interface Calibration {
  /** Ascending by min_coverage, starting at 0. */
  bands: ResidualBand[]
}

export const COVERAGE_BAND_EDGES: readonly number[] = [0, 0.25, 0.5]

export interface CalibrationOptions {
  /** A band with fewer residuals than this uses the pooled residuals (default 40). */
  minBandSize?: number
  /** Cap on stored quantiles per band (default 199). */
  maxQuantiles?: number
}

function summarize(sorted: number[], maxQuantiles: number): number[] {
  if (sorted.length <= maxQuantiles) return sorted
  return Array.from({ length: maxQuantiles }, (_, i) => sortedQuantile(sorted, (i + 0.5) / maxQuantiles))
}

/** Linear-interpolated quantile of a sorted sample at positions (i + 0.5) / n. */
function sortedQuantile(sorted: readonly number[], p: number): number {
  const t = Math.min(sorted.length - 1, Math.max(0, p * sorted.length - 0.5))
  const i = Math.floor(t)
  const frac = t - i
  return i + 1 < sorted.length ? sorted[i] * (1 - frac) + sorted[i + 1] * frac : sorted[i]
}

/**
 * Groups residuals by coverage band. A band with too few residuals borrows the
 * pooled set, so a sparse band is never more confident than the data allows.
 */
export function calibrate(
  residuals: ReadonlyArray<{ coverage: number; residual: number }>,
  options: CalibrationOptions = {},
): Calibration {
  if (residuals.length === 0) throw new Error('projection model: no residuals to calibrate')
  const minBandSize = options.minBandSize ?? 40
  const maxQuantiles = options.maxQuantiles ?? 199
  const pooled = residuals.map((r) => r.residual).sort((a, b) => a - b)
  const bands = COVERAGE_BAND_EDGES.map((edge, i) => {
    const next = COVERAGE_BAND_EDGES[i + 1] ?? Infinity
    const own = residuals
      .filter((r) => r.coverage >= edge && r.coverage < next)
      .map((r) => r.residual)
      .sort((a, b) => a - b)
    const sample = own.length >= minBandSize ? own : pooled
    return { min_coverage: edge, n: sample.length, quantiles: summarize(sample, maxQuantiles) }
  })
  return { bands }
}

export function bandFor(calibration: Calibration, coverageValue: number): ResidualBand {
  let band = calibration.bands[0]
  for (const candidate of calibration.bands) if (coverageValue >= candidate.min_coverage) band = candidate
  return band
}

function bandQuantile(band: ResidualBand, p: number): number {
  return sortedQuantile(band.quantiles, p)
}

/** Residual CDF: linear between stored quantiles, with short linear tails beyond them. */
function bandCdf(band: ResidualBand, r: number): number {
  const q = band.quantiles
  const m = q.length
  const edge = 0.5 / m
  const tail = Math.max(0.05, ((q[m - 1] - q[0]) * 2) / m)
  if (r <= q[0]) return edge * Math.max(0, 1 - (q[0] - r) / tail)
  if (r >= q[m - 1]) return 1 - edge * Math.max(0, 1 - (r - q[m - 1]) / tail)
  let lo = 0
  let hi = m - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (q[mid] <= r) lo = mid
    else hi = mid
  }
  const width = q[hi] - q[lo]
  const frac = width > 0 ? (r - q[lo]) / width : 1
  return (lo + 0.5 + frac) / m
}

/**
 * Split-conformal range at `level` (e.g. 0.8): residual order statistics of
 * rank floor((n+1)(1-level)/2) and ceil((n+1)(1+level)/2), so the range holds
 * at least `level` of outcomes for exchangeable films. Too few residuals for a
 * rank leaves that side open (0 or 100).
 */
export function conformalInterval(z: number, band: ResidualBand, level: number): [number, number] {
  const n = band.n
  const lowRank = Math.floor(((n + 1) * (1 - level)) / 2)
  const highRank = Math.ceil(((n + 1) * (1 + level)) / 2)
  const lo = lowRank < 1 ? 0 : logitToRt(z + bandQuantile(band, (lowRank - 0.5) / n))
  const hi = highRank > n ? 100 : logitToRt(z + bandQuantile(band, (highRank - 0.5) / n))
  return [lo, hi]
}

// ---------------------------------------------------------------------------
// Distributions over 1-point RT bins
// ---------------------------------------------------------------------------

/** Probability of each whole Tomatometer 0..100 (101 entries, summing to 1). */
export type RtDistribution = Float64Array

/** Bin i covers [i - 0.5, i + 0.5), clipped to [0, 100]. */
function binEdges(i: number): [number, number] {
  return [Math.max(0, i - 0.5), Math.min(100, i + 0.5)]
}

/** The projection's distribution: z plus the band's residuals, binned by RT. */
export function residualDistribution(z: number, band: ResidualBand): RtDistribution {
  const dist = new Float64Array(101)
  let previous = 0
  for (let i = 0; i < 100; i++) {
    const cdf = bandCdf(band, logit((i + 0.5) / 100) - z)
    dist[i] = Math.max(0, cdf - previous)
    previous = Math.max(previous, cdf)
  }
  dist[100] = Math.max(0, 1 - previous)
  return dist
}

/** Beta(alpha, beta) on the 0-1 share, binned by RT (midpoint rule within each bin). */
export function betaDistribution(alpha: number, beta: number): RtDistribution {
  const steps = 20
  const dist = new Float64Array(101)
  const logs: number[] = []
  for (let i = 0; i <= 100; i++) {
    const [lo, hi] = binEdges(i)
    for (let s = 0; s < steps; s++) {
      const x = (lo + ((s + 0.5) * (hi - lo)) / steps) / 100
      logs.push((alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x) + Math.log((hi - lo) / steps))
    }
  }
  const max = Math.max(...logs)
  let total = 0
  for (let i = 0; i <= 100; i++) {
    let mass = 0
    for (let s = 0; s < steps; s++) mass += Math.exp(logs[i * steps + s] - max)
    dist[i] = mass
    total += mass
  }
  for (let i = 0; i <= 100; i++) dist[i] /= total
  return dist
}

/** The RT at cumulative probability p, linear within a bin. */
export function distributionQuantile(dist: RtDistribution, p: number): number {
  let cumulative = 0
  for (let i = 0; i <= 100; i++) {
    const next = cumulative + dist[i]
    if (next >= p && dist[i] > 0) {
      const [lo, hi] = binEdges(i)
      return lo + ((p - cumulative) / dist[i]) * (hi - lo)
    }
    cumulative = next
  }
  return 100
}

/** Mean and variance of the share (RT / 100). */
export function distributionMoments(dist: RtDistribution): { mean: number; variance: number } {
  let mean = 0
  for (let i = 0; i <= 100; i++) mean += dist[i] * (i / 100)
  let variance = 0
  for (let i = 0; i <= 100; i++) variance += dist[i] * (i / 100 - mean) ** 2
  return { mean, variance }
}

export interface OutcomeSummary {
  p_rotten: number
  p_fresh: number
  p_90: number
  /** Standard rule. */
  expected_points: number
  /** 90+ doubled. */
  expected_points_double: number
}

/** Probabilities and expected points, summed over the bins through the scoring curve. */
export function summarizeOutcomes(dist: RtDistribution): OutcomeSummary {
  let rotten = 0
  let club90 = 0
  let points = 0
  let pointsDouble = 0
  for (let i = 0; i <= 100; i++) {
    if (i < 60) rotten += dist[i]
    if (i >= 90) club90 += dist[i]
    points += dist[i] * fantasyPointsForTomatometer(i)
    pointsDouble += dist[i] * fantasyPointsForTomatometer(i, true)
  }
  return { p_rotten: rotten, p_fresh: 1 - rotten, p_90: club90, expected_points: points, expected_points_double: pointsDouble }
}

// ---------------------------------------------------------------------------
// Early-review update
// ---------------------------------------------------------------------------

export interface EarlyReviews {
  /** Early Tomatometer 0-100. */
  score: number
  /** Reviews behind it. */
  reviews: number
}

/** Default weight of one early review relative to a final one (festival critics skew). */
export const DEFAULT_EARLY_REVIEW_DISCOUNT = 0.5

/**
 * Treats the projection as a Beta prior with the same mean and spread, and
 * adds k positive of n early reviews at weight c:
 *   Beta(a + c k, b + c (n - k)).
 * By ~100 reviews the posterior is essentially the observed score.
 */
export function earlyReviewPosterior(
  prior: RtDistribution,
  early: EarlyReviews,
  discount = DEFAULT_EARLY_REVIEW_DISCOUNT,
): { distribution: RtDistribution; alpha: number; beta: number } {
  const { mean: rawMean, variance } = distributionMoments(prior)
  const mean = Math.min(0.995, Math.max(0.005, rawMean))
  const maxVariance = mean * (1 - mean)
  const strength = Math.max(0.5, maxVariance / Math.min(Math.max(variance, 1e-6), 0.999 * maxVariance) - 1)
  const positive = Math.round((Math.min(100, Math.max(0, early.score)) / 100) * early.reviews)
  const alpha = mean * strength + discount * positive
  const beta = (1 - mean) * strength + discount * (early.reviews - positive)
  return { distribution: betaDistribution(alpha, beta), alpha, beta }
}

// ---------------------------------------------------------------------------
// The fitted model
// ---------------------------------------------------------------------------

/** Everything needed to project a film; stored as projection_models.coefficients. */
export interface ProjectionModel {
  format: 1
  feature_keys: string[]
  regression: Regression
  calibration: Calibration
  early_review_discount: number
  training: { rows: number; first_year: number; last_year: number; calibration_years: number[] }
}

export function assembleModel(
  regression: Regression,
  calibration: Calibration,
  training: ProjectionModel['training'],
  earlyReviewDiscount = DEFAULT_EARLY_REVIEW_DISCOUNT,
): ProjectionModel {
  return {
    format: 1,
    feature_keys: [...FEATURE_KEYS],
    regression: {
      shrinkage: { ...regression.shrinkage },
      intercept: regression.intercept,
      coefficients: [...regression.coefficients],
      lambda: regression.lambda,
    },
    calibration,
    early_review_discount: earlyReviewDiscount,
    training,
  }
}

export interface FitModelOptions extends ChainOptions, CalibrationOptions {
  /** Years whose forward-chained residuals calibrate the ranges (default: the latest 5 with data). */
  calibrationYears?: readonly number[]
  earlyReviewDiscount?: number
}

/**
 * The fit cron's whole job: forward-chain the calibration years for honest
 * residuals, fit the final regression on every row, and package both.
 */
export function fitProjectionModel(
  rows: readonly ModelRow[],
  options: FitModelOptions = {},
): { model: ProjectionModel; chain: ChainPrediction[] } {
  if (rows.length === 0) throw new Error('projection model: no training rows')
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  const calibrationYears = options.calibrationYears ?? years.slice(1).slice(-5)
  const { predictions } = forwardChain(rows, calibrationYears, options)
  if (predictions.length === 0) throw new Error('projection model: no calibration year had enough earlier films')
  const regression = fitRegression(rows, options)
  const model = assembleModel(
    regression,
    calibrate(predictions, options),
    {
      rows: rows.length,
      first_year: years[0],
      last_year: years[years.length - 1],
      calibration_years: [...new Set(predictions.map((p) => p.row.year))],
    },
    options.earlyReviewDiscount,
  )
  return { model, chain: predictions }
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * Each factor group's share of the gap between the baseline and the
 * projection, in RT points. Logit terms add up, but RT does not, so every term
 * is converted at the same rate -- the secant of the RT curve between the
 * baseline and the projection -- which makes the deltas sum exactly to
 * projected RT - baseline RT and keeps each one's sign.
 */
export function contributions(raw: RawFeatures, prediction: LogitPrediction): ProjectionContribution[] {
  const { z, baselineZ, terms } = prediction
  const gap = z - baselineZ
  const p = logitToRt(baselineZ) / 100
  const rate = Math.abs(gap) > 1e-9 ? (logitToRt(z) - logitToRt(baselineZ)) / gap : 100 * p * (1 - p)
  const byGroup = new Map<string, number>()
  FEATURE_SPECS.forEach((spec, j) => byGroup.set(spec.group, (byGroup.get(spec.group) ?? 0) + terms[j]))
  return [...byGroup]
    .filter(([, logitDelta]) => Math.abs(logitDelta) > 1e-12)
    .map(([group, logitDelta]) => ({ factor: group, label: groupLabel(group, raw), delta_rt: logitDelta * rate }))
    .sort((a, b) => Math.abs(b.delta_rt) - Math.abs(a.delta_rt))
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/** One movie's projection under both scoring rules; what movie_projections caches. */
export interface ProjectionResult extends Omit<MovieProjection, 'expected_points' | 'low_confidence' | 'insufficient_history'> {
  /** Standard rule. */
  expected_points: number
  /** 90+ doubled. */
  expected_points_double: number
}

export interface ProjectOptions {
  early?: EarlyReviews | null
  partial?: boolean
  computedAt?: string
}

const LOW_CONFIDENCE_WIDTH = 10
const INSUFFICIENT_COVERAGE = 0.25

const round = (value: number, places: number) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
const round1 = (value: number) => round(value, 1)

/**
 * Rounds the contributions to one decimal and nudges the largest so the
 * rounded baseline plus the rounded deltas equals the rounded headline.
 */
function roundContributions(items: ProjectionContribution[], baseline: number, headline: number): ProjectionContribution[] {
  const rounded = items.map((c) => ({ ...c, delta_rt: round1(c.delta_rt) }))
  const drift = round1(headline - baseline - rounded.reduce((sum, c) => sum + c.delta_rt, 0))
  if (rounded.length > 0 && drift !== 0) rounded[0].delta_rt = round1(rounded[0].delta_rt + drift)
  return rounded.filter((c) => c.delta_rt !== 0)
}

/** Projects one film from its raw features. */
export function projectFilm(model: ProjectionModel, raw: RawFeatures, options: ProjectOptions = {}): ProjectionResult {
  const prediction = predictLogit(model.regression, raw)
  const filmCoverage = coverage(raw, model.regression.shrinkage)
  const band = bandFor(model.calibration, filmCoverage)
  const priorDistribution = residualDistribution(prediction.z, band)
  const baselineRt = round1(logitToRt(prediction.baselineZ))
  const priorRt = logitToRt(prediction.z)
  const explained = contributions(raw, prediction)

  const early = options.early && options.early.reviews > 0 ? options.early : null
  let projected = priorRt
  let range50 = conformalInterval(prediction.z, band, 0.5)
  let range80 = conformalInterval(prediction.z, band, 0.8)
  let distribution = priorDistribution
  if (early) {
    distribution = earlyReviewPosterior(priorDistribution, early, model.early_review_discount).distribution
    projected = distributionQuantile(distribution, 0.5)
    range50 = [distributionQuantile(distribution, 0.25), distributionQuantile(distribution, 0.75)]
    range80 = [distributionQuantile(distribution, 0.1), distributionQuantile(distribution, 0.9)]
    explained.push({ factor: 'early_reviews', label: `Early reviews (${early.reviews})`, delta_rt: projected - priorRt })
  }
  const outcomes = summarizeOutcomes(distribution)
  const projectedRt = round1(projected)

  return {
    tmdb_id: raw.tmdb_id,
    projected_rt: projectedRt,
    range50: [round1(range50[0]), round1(range50[1])],
    range80: [round1(range80[0]), round1(range80[1])],
    p_rotten: round(outcomes.p_rotten, 3),
    p_fresh: round(outcomes.p_fresh, 3),
    p_90: round(outcomes.p_90, 3),
    expected_points: round(outcomes.expected_points, 2),
    expected_points_double: round(outcomes.expected_points_double, 2),
    baseline_rt: baselineRt,
    contributions: roundContributions(
      explained.sort((a, b) => Math.abs(b.delta_rt) - Math.abs(a.delta_rt)),
      baselineRt,
      projectedRt,
    ),
    coverage: round(filmCoverage, 2),
    partial: options.partial ?? false,
    includes_early_reviews: early != null,
    early_rt: early ? { score: early.score, reviews: early.reviews } : null,
    computed_at: options.computedAt ?? new Date().toISOString(),
  }
}

/** The contracts' per-league payload: picks expected points by the league's 90+ rule. */
export function toMovieProjection(result: ProjectionResult, doublePointsOver90: boolean): MovieProjection {
  const { expected_points_double, ...rest } = result
  return {
    ...rest,
    expected_points: doublePointsOver90 ? expected_points_double : result.expected_points,
    low_confidence: result.range50[1] - result.range50[0] > LOW_CONFIDENCE_WIDTH,
    insufficient_history: result.coverage < INSUFFICIENT_COVERAGE,
  }
}

/** A movie_projections row (frozen_at / actual_rt are update-scores' to set). */
export interface MovieProjectionRow {
  tmdb_id: number
  model_version: number
  projected_rt: number
  range50_lo: number
  range50_hi: number
  range80_lo: number
  range80_hi: number
  p_rotten: number
  p_fresh: number
  p_club90: number
  expected_points: number
  expected_points_double: number
  factors: ProjectionContribution[]
  baseline_rt: number
  coverage: number
  partial: boolean
  includes_early_reviews: boolean
  early_rt_score: number | null
  early_rt_reviews: number | null
  computed_at: string
}

export function toProjectionRow(result: ProjectionResult, modelVersion: number): MovieProjectionRow {
  return {
    tmdb_id: result.tmdb_id,
    model_version: modelVersion,
    projected_rt: result.projected_rt,
    range50_lo: result.range50[0],
    range50_hi: result.range50[1],
    range80_lo: result.range80[0],
    range80_hi: result.range80[1],
    p_rotten: result.p_rotten,
    p_fresh: result.p_fresh,
    p_club90: result.p_90,
    expected_points: result.expected_points,
    expected_points_double: result.expected_points_double,
    factors: result.contributions,
    baseline_rt: result.baseline_rt,
    coverage: result.coverage,
    partial: result.partial,
    includes_early_reviews: result.includes_early_reviews,
    early_rt_score: result.early_rt?.score ?? null,
    early_rt_reviews: result.early_rt?.reviews ?? null,
    computed_at: result.computed_at,
  }
}

/** The inverse of `toProjectionRow`, for serving a cached row. */
export function fromProjectionRow(row: MovieProjectionRow): ProjectionResult {
  return {
    tmdb_id: row.tmdb_id,
    projected_rt: Number(row.projected_rt),
    range50: [Number(row.range50_lo), Number(row.range50_hi)],
    range80: [Number(row.range80_lo), Number(row.range80_hi)],
    p_rotten: Number(row.p_rotten),
    p_fresh: Number(row.p_fresh),
    p_90: Number(row.p_club90),
    expected_points: Number(row.expected_points),
    expected_points_double: Number(row.expected_points_double),
    baseline_rt: Number(row.baseline_rt),
    contributions: row.factors,
    coverage: Number(row.coverage),
    partial: row.partial,
    includes_early_reviews: row.includes_early_reviews,
    early_rt: row.early_rt_score != null && row.early_rt_reviews != null
      ? { score: Number(row.early_rt_score), reviews: Number(row.early_rt_reviews) }
      : null,
    computed_at: row.computed_at,
  }
}

// ---------------------------------------------------------------------------
// Serialization (projection_models.coefficients)
// ---------------------------------------------------------------------------

/** JSON for projection_models.coefficients. */
export function serializeProjectionModel(model: ProjectionModel): string {
  return JSON.stringify(model)
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`projection model: ${path} is not a finite number`)
  return value
}

function numberList(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`projection model: ${path} is not an array`)
  return value.map((v, i) => finiteNumber(v, `${path}[${i}]`))
}

/**
 * Reads projection_models.coefficients back (a JSON string or the parsed
 * jsonb). Refuses a model fitted for a different feature set, since its
 * coefficients would line up with the wrong columns.
 */
export function deserializeProjectionModel(input: unknown): ProjectionModel {
  const value = typeof input === 'string' ? JSON.parse(input) : input
  if (value == null || typeof value !== 'object') throw new Error('projection model: not an object')
  const m = value as Record<string, unknown>
  if (m.format !== 1) throw new Error(`projection model: unsupported format ${String(m.format)}`)
  const keys = m.feature_keys
  if (!Array.isArray(keys) || keys.length !== FEATURE_KEYS.length || keys.some((k, i) => k !== FEATURE_KEYS[i])) {
    throw new Error('projection model: fitted for a different feature set; refit it')
  }
  const r = (m.regression ?? {}) as Record<string, unknown>
  const coefficients = numberList(r.coefficients, 'regression.coefficients')
  if (coefficients.length !== FEATURE_KEYS.length) throw new Error('projection model: coefficient count mismatch')
  const s = (r.shrinkage ?? {}) as Record<string, unknown>
  const shrinkage = Object.fromEntries(
    SHRUNK_FACTORS.map((f) => [f, finiteNumber(s[f], `regression.shrinkage.${f}`)]),
  ) as Shrinkage
  const c = (m.calibration ?? {}) as Record<string, unknown>
  if (!Array.isArray(c.bands) || c.bands.length === 0) throw new Error('projection model: calibration has no bands')
  const bands = c.bands.map((band: Record<string, unknown>, i: number) => {
    const quantiles = numberList(band.quantiles, `calibration.bands[${i}].quantiles`)
    if (quantiles.length === 0) throw new Error(`projection model: band ${i} has no residuals`)
    return {
      min_coverage: finiteNumber(band.min_coverage, `calibration.bands[${i}].min_coverage`),
      n: finiteNumber(band.n, `calibration.bands[${i}].n`),
      quantiles,
    }
  })
  const t = (m.training ?? {}) as Record<string, unknown>
  return {
    format: 1,
    feature_keys: [...FEATURE_KEYS],
    regression: {
      shrinkage,
      intercept: finiteNumber(r.intercept, 'regression.intercept'),
      coefficients,
      lambda: finiteNumber(r.lambda, 'regression.lambda'),
    },
    calibration: { bands },
    early_review_discount: finiteNumber(m.early_review_discount, 'early_review_discount'),
    training: {
      rows: finiteNumber(t.rows, 'training.rows'),
      first_year: finiteNumber(t.first_year, 'training.first_year'),
      last_year: finiteNumber(t.last_year, 'training.last_year'),
      calibration_years: numberList(t.calibration_years, 'training.calibration_years'),
    },
  }
}
