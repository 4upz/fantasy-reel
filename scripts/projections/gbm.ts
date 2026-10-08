/**
 * A small gradient-boosted regression-tree model (squared loss, histogram
 * splits), used only as the backtest's challenger to the linear projection
 * model. It never ships: the plan keeps the linear model unless this beats it
 * by more than 1.5 RT points of MAE, because the linear one can be explained.
 */

import { seededRandom } from '../../supabase/functions/_shared/projection-synthetic.ts'

export interface GbmOptions {
  trees?: number
  depth?: number
  learningRate?: number
  /** Fewest training rows in a leaf. */
  minLeaf?: number
  /** Candidate thresholds per feature (quantiles of the training values). */
  bins?: number
  /** Share of rows each tree sees. */
  subsample?: number
  seed?: number
}

type Node =
  | { leaf: true; value: number }
  | { leaf: false; feature: number; threshold: number; left: Node; right: Node }

export interface GbmModel {
  base: number
  learningRate: number
  trees: Node[]
}

/** Distinct quantile thresholds per column: a row goes left when x <= threshold. */
function thresholds(X: number[][], bins: number): number[][] {
  const p = X[0]?.length ?? 0
  return Array.from({ length: p }, (_, j) => {
    const values = [...new Set(X.map((x) => x[j]))].sort((a, b) => a - b)
    if (values.length <= bins) return values.slice(0, -1)
    const cuts = new Set<number>()
    for (let b = 1; b < bins; b++) cuts.add(values[Math.floor((b * values.length) / bins)])
    return [...cuts].sort((a, b) => a - b)
  })
}

/** Index of the first threshold >= x: the bin a value falls in. */
function binOf(cuts: readonly number[], x: number): number {
  let lo = 0
  let hi = cuts.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cuts[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function fitGbm(X: number[][], y: number[], options: GbmOptions = {}): GbmModel {
  const n = X.length
  if (n === 0) throw new Error('gbm: no training rows')
  const trees = options.trees ?? 200
  const depth = options.depth ?? 3
  const learningRate = options.learningRate ?? 0.05
  const minLeaf = options.minLeaf ?? 20
  const subsample = options.subsample ?? 0.8
  const random = seededRandom(options.seed ?? 7)
  const cuts = thresholds(X, options.bins ?? 32)
  const p = cuts.length
  const binned = X.map((x) => x.map((v, j) => binOf(cuts[j], v)))

  const base = y.reduce((a, b) => a + b, 0) / n
  const prediction = new Float64Array(n).fill(base)
  const model: GbmModel = { base, learningRate, trees: [] }

  const grow = (rows: number[], residual: Float64Array, level: number): Node => {
    let sum = 0
    for (const r of rows) sum += residual[r]
    const leafValue = sum / rows.length
    if (level >= depth || rows.length < 2 * minLeaf) return { leaf: true, value: leafValue }

    let best: { gain: number; feature: number; bin: number } | null = null
    const parentScore = (sum * sum) / rows.length
    for (let j = 0; j < p; j++) {
      const k = cuts[j].length
      if (k === 0) continue
      const sums = new Float64Array(k + 1)
      const counts = new Int32Array(k + 1)
      for (const r of rows) {
        const b = binned[r][j]
        sums[b] += residual[r]
        counts[b]++
      }
      let leftSum = 0
      let leftCount = 0
      for (let b = 0; b < k; b++) {
        leftSum += sums[b]
        leftCount += counts[b]
        const rightCount = rows.length - leftCount
        if (leftCount < minLeaf || rightCount < minLeaf) continue
        const rightSum = sum - leftSum
        const gain = (leftSum * leftSum) / leftCount + (rightSum * rightSum) / rightCount - parentScore
        if (gain > 1e-12 && (!best || gain > best.gain)) best = { gain, feature: j, bin: b }
      }
    }
    if (!best) return { leaf: true, value: leafValue }
    const left: number[] = []
    const right: number[] = []
    for (const r of rows) (binned[r][best.feature] <= best.bin ? left : right).push(r)
    return {
      leaf: false,
      feature: best.feature,
      threshold: cuts[best.feature][best.bin],
      left: grow(left, residual, level + 1),
      right: grow(right, residual, level + 1),
    }
  }

  const residual = new Float64Array(n)
  for (let t = 0; t < trees; t++) {
    for (let i = 0; i < n; i++) residual[i] = y[i] - prediction[i]
    const rows: number[] = []
    for (let i = 0; i < n; i++) if (random() < subsample) rows.push(i)
    if (rows.length < 2 * minLeaf) continue
    const tree = grow(rows, residual, 0)
    model.trees.push(tree)
    for (let i = 0; i < n; i++) prediction[i] += learningRate * evaluate(tree, X[i])
  }
  return model
}

function evaluate(node: Node, x: readonly number[]): number {
  while (!node.leaf) node = x[node.feature] <= node.threshold ? node.left : node.right
  return node.value
}

export function predictGbm(model: GbmModel, x: readonly number[]): number {
  let value = model.base
  for (const tree of model.trees) value += model.learningRate * evaluate(tree, x)
  return value
}
