/**
 * Ridge regression on standardized features, with the penalty chosen by a
 * time-ordered inner split.
 *
 * Each column is centered and scaled to unit variance on the training rows, so
 * one penalty treats every feature alike whatever its units; the fitted
 * coefficients are mapped back to the original scale, so callers predict with
 * plain `intercept + coefficients . x` and read each term as a contribution.
 * The intercept is never penalized.
 *
 * The objective is  sum (y - a - z.b)^2 + lambda * n * |b|^2  over the
 * standardized z, i.e. lambda is per training row, which keeps one penalty
 * grid meaningful across corpus sizes.
 *
 * Pure: no I/O, no Supabase. Used by the projection model and its backtest.
 */

export interface RidgeModel {
  intercept: number
  /** Original-scale coefficients, one per column. */
  coefficients: number[]
  lambda: number
}

/** Log-spaced from 1e-4 to 10, per training row. */
export const DEFAULT_RIDGE_LAMBDAS: readonly number[] = Array.from(
  { length: 11 },
  (_, i) => 10 ** (-4 + i * 0.5),
)

/** Centered cross-products of a row subset, the sufficient statistics of a ridge fit. */
interface CrossProducts {
  n: number
  means: number[]
  yMean: number
  /** Centered X'X (p x p, row-major). */
  xx: Float64Array
  /** Centered X'y. */
  xy: Float64Array
}

function crossProducts(X: number[][], y: number[], rows: readonly number[]): CrossProducts {
  const n = rows.length
  if (n === 0) throw new Error('ridge: no training rows')
  const p = X[rows[0]].length
  const means = new Array<number>(p).fill(0)
  let yMean = 0
  for (const r of rows) {
    const x = X[r]
    for (let j = 0; j < p; j++) means[j] += x[j]
    yMean += y[r]
  }
  for (let j = 0; j < p; j++) means[j] /= n
  yMean /= n

  const xx = new Float64Array(p * p)
  const xy = new Float64Array(p)
  const centered = new Float64Array(p)
  for (const r of rows) {
    const x = X[r]
    for (let j = 0; j < p; j++) centered[j] = x[j] - means[j]
    const dy = y[r] - yMean
    for (let j = 0; j < p; j++) {
      const cj = centered[j]
      if (cj === 0) continue
      xy[j] += cj * dy
      const rowOffset = j * p
      for (let k = j; k < p; k++) xx[rowOffset + k] += cj * centered[k]
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = j + 1; k < p; k++) xx[k * p + j] = xx[j * p + k]
  }
  return { n, means, yMean, xx, xy }
}

/** Solves A x = b for symmetric positive-definite A (row-major p x p) by Cholesky. */
function solveSpd(a: Float64Array, b: Float64Array, p: number): Float64Array {
  const l = new Float64Array(p * p)
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * p + j]
      for (let k = 0; k < j; k++) sum -= l[i * p + k] * l[j * p + k]
      if (i === j) {
        if (sum <= 0) throw new Error('ridge: matrix is not positive definite')
        l[i * p + i] = Math.sqrt(sum)
      } else {
        l[i * p + j] = sum / l[j * p + j]
      }
    }
  }
  const z = new Float64Array(p)
  for (let i = 0; i < p; i++) {
    let sum = b[i]
    for (let k = 0; k < i; k++) sum -= l[i * p + k] * z[k]
    z[i] = sum / l[i * p + i]
  }
  const x = new Float64Array(p)
  for (let i = p - 1; i >= 0; i--) {
    let sum = z[i]
    for (let k = i + 1; k < p; k++) sum -= l[k * p + i] * x[k]
    x[i] = sum / l[i * p + i]
  }
  return x
}

function solveFromCrossProducts(cp: CrossProducts, lambda: number): RidgeModel {
  if (!(lambda > 0)) throw new Error('ridge: lambda must be positive')
  const p = cp.means.length
  // Scale by each column's training standard deviation; a constant column
  // keeps scale 1 and, having no centered variance, gets coefficient 0.
  const scale = new Float64Array(p)
  for (let j = 0; j < p; j++) {
    const sd = Math.sqrt(cp.xx[j * p + j] / cp.n)
    scale[j] = sd > 1e-12 ? sd : 1
  }
  const a = new Float64Array(p * p)
  const b = new Float64Array(p)
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < p; k++) a[j * p + k] = cp.xx[j * p + k] / (scale[j] * scale[k])
    a[j * p + j] += lambda * cp.n
    b[j] = cp.xy[j] / scale[j]
  }
  const standardized = solveSpd(a, b, p)
  const coefficients = Array.from(standardized, (beta, j) => beta / scale[j])
  let intercept = cp.yMean
  for (let j = 0; j < p; j++) intercept -= coefficients[j] * cp.means[j]
  return { intercept, coefficients, lambda }
}

function allRows(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/** Fits ridge on `rows` of X (all rows by default) at a fixed per-row penalty. */
export function fitRidge(
  X: number[][],
  y: number[],
  lambda: number,
  rows: readonly number[] = allRows(X.length),
): RidgeModel {
  return solveFromCrossProducts(crossProducts(X, y, rows), lambda)
}

export function predictRidge(model: RidgeModel, x: readonly number[]): number {
  let value = model.intercept
  for (let j = 0; j < x.length; j++) value += model.coefficients[j] * x[j]
  return value
}

export interface PenaltySearchOptions {
  lambdas?: readonly number[]
  /** Number of validation blocks carved from the latest rows (default 3). */
  folds?: number
  /** Share of the earliest rows that is only ever trained on (default 0.5). */
  minTrainFraction?: number
}

export interface PenaltySearchResult {
  lambda: number
  /** Mean validation MSE per candidate, in `lambdas` order. */
  scores: Array<{ lambda: number; mse: number }>
}

/**
 * Splits rows into time-ordered (train, validate) folds: the latest
 * `1 - minTrainFraction` of rows is cut into `folds` consecutive blocks, and
 * each block is validated by a fit on every row strictly earlier than it, so
 * nothing is ever predicted from the future.
 */
export function timeOrderedFolds(
  times: readonly number[],
  folds = 3,
  minTrainFraction = 0.5,
): Array<{ train: number[]; validate: number[] }> {
  const order = allRows(times.length).sort((a, b) => times[a] - times[b] || a - b)
  const n = order.length
  const start = Math.max(1, Math.floor(n * minTrainFraction))
  const blockSize = (n - start) / folds
  const result: Array<{ train: number[]; validate: number[] }> = []
  for (let f = 0; f < folds; f++) {
    let lo = start + Math.round(f * blockSize)
    const hi = start + Math.round((f + 1) * blockSize)
    // Rows sharing a time stay on one side of the cut, so a block never
    // trains on a row released the same day as one it validates.
    while (lo > 0 && lo < n && times[order[lo]] === times[order[lo - 1]]) lo++
    if (hi <= lo) continue
    result.push({ train: order.slice(0, lo), validate: order.slice(lo, hi) })
  }
  return result
}

/**
 * Picks the ridge penalty by time-ordered validation (see `timeOrderedFolds`).
 * Ties go to the larger penalty, the simpler model. With too few rows to fold
 * it returns the median candidate.
 */
export function searchRidgePenalty(
  X: number[][],
  y: number[],
  times: readonly number[],
  options: PenaltySearchOptions = {},
): PenaltySearchResult {
  const lambdas = options.lambdas ?? DEFAULT_RIDGE_LAMBDAS
  if (lambdas.length === 0) throw new Error('ridge: no penalty candidates')
  const folds = timeOrderedFolds(times, options.folds ?? 3, options.minTrainFraction ?? 0.5)
    .filter((fold) => fold.train.length >= 2)
  if (folds.length === 0) {
    const lambda = [...lambdas].sort((a, b) => a - b)[Math.floor(lambdas.length / 2)]
    return { lambda, scores: lambdas.map((l) => ({ lambda: l, mse: Number.NaN })) }
  }

  const totals = new Array<number>(lambdas.length).fill(0)
  for (const fold of folds) {
    const cp = crossProducts(X, y, fold.train)
    lambdas.forEach((lambda, i) => {
      const model = solveFromCrossProducts(cp, lambda)
      let squared = 0
      for (const r of fold.validate) squared += (y[r] - predictRidge(model, X[r])) ** 2
      totals[i] += squared / fold.validate.length
    })
  }
  const scores = lambdas.map((lambda, i) => ({ lambda, mse: totals[i] / folds.length }))
  let best = scores[0]
  for (const score of scores) {
    if (score.mse < best.mse - 1e-12 || (Math.abs(score.mse - best.mse) <= 1e-12 && score.lambda > best.lambda)) {
      best = score
    }
  }
  return { lambda: best.lambda, scores }
}

/** Chooses the penalty by time-ordered search, then refits on every row. */
export function fitRidgeWithPenaltySearch(
  X: number[][],
  y: number[],
  times: readonly number[],
  options: PenaltySearchOptions = {},
): { model: RidgeModel; search: PenaltySearchResult } {
  const search = searchRidgePenalty(X, y, times, options)
  return { model: fitRidge(X, y, search.lambda), search }
}
