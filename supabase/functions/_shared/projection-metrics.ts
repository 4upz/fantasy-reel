/**
 * Accuracy and calibration metrics for projections: what the backtest gate
 * checks, and what the fit cron can record in projection_models.metrics.
 * Pure: no I/O.
 */

export function meanAbsoluteError(predicted: readonly number[], actual: readonly number[]): number {
  if (predicted.length !== actual.length) throw new Error('metrics: length mismatch')
  if (predicted.length === 0) return Number.NaN
  let total = 0
  for (let i = 0; i < predicted.length; i++) total += Math.abs(predicted[i] - actual[i])
  return total / predicted.length
}

/** 1-based ranks, ties sharing their average rank. */
function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const rank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[order[k][1]] = rank
    i = j + 1
  }
  return ranks
}

/** Spearman rank correlation (Pearson on average ranks). NaN when either side is constant. */
export function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('metrics: length mismatch')
  const n = a.length
  if (n < 2) return Number.NaN
  const ra = averageRanks(a)
  const rb = averageRanks(b)
  const mean = (n + 1) / 2
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - mean) * (rb[i] - mean)
    va += (ra[i] - mean) ** 2
    vb += (rb[i] - mean) ** 2
  }
  return va === 0 || vb === 0 ? Number.NaN : cov / Math.sqrt(va * vb)
}

export interface CalibrationBin {
  n: number
  /** Mean predicted probability in the bin. */
  predicted: number
  /** Share of the bin where the event happened. */
  observed: number
}

/**
 * Equal-count bins (deciles by default) of predictions sorted by predicted
 * probability; a calibrated forecast has observed ≈ predicted in every bin.
 */
export function calibrationBins(
  predicted: readonly number[],
  happened: readonly boolean[],
  bins = 10,
): CalibrationBin[] {
  if (predicted.length !== happened.length) throw new Error('metrics: length mismatch')
  const order = predicted.map((_, i) => i).sort((a, b) => predicted[a] - predicted[b])
  const result: CalibrationBin[] = []
  for (let b = 0; b < bins; b++) {
    const lo = Math.round((b * order.length) / bins)
    const hi = Math.round(((b + 1) * order.length) / bins)
    if (hi <= lo) continue
    let p = 0
    let o = 0
    for (let k = lo; k < hi; k++) {
      p += predicted[order[k]]
      o += happened[order[k]] ? 1 : 0
    }
    result.push({ n: hi - lo, predicted: p / (hi - lo), observed: o / (hi - lo) })
  }
  return result
}

/** Largest |observed - predicted| over the bins. */
export function maxCalibrationError(bins: readonly CalibrationBin[]): number {
  return bins.reduce((worst, bin) => Math.max(worst, Math.abs(bin.observed - bin.predicted)), 0)
}

/** Share of outcomes inside their [lo, hi] range (inclusive). */
export function intervalCoverage(ranges: ReadonlyArray<readonly [number, number]>, actual: readonly number[]): number {
  if (ranges.length !== actual.length) throw new Error('metrics: length mismatch')
  if (ranges.length === 0) return Number.NaN
  let inside = 0
  for (let i = 0; i < ranges.length; i++) if (actual[i] >= ranges[i][0] && actual[i] <= ranges[i][1]) inside++
  return inside / ranges.length
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
