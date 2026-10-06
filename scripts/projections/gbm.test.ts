/** Unit tests for the backtest's gradient-boosted challenger. */

import { assert, assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.0'
import { fitGbm, predictGbm } from './gbm.ts'

Deno.test('fitGbm - learns a step and an interaction a line cannot', () => {
  const X: number[][] = []
  const y: number[] = []
  for (let i = 0; i < 400; i++) {
    const a = (i % 20) / 20
    const b = Math.floor(i / 20) / 20
    X.push([a, b])
    y.push(a > 0.5 && b > 0.5 ? 2 : 0)
  }
  const model = fitGbm(X, y, { trees: 150, learningRate: 0.2, minLeaf: 5 })
  assertAlmostEquals(predictGbm(model, [0.9, 0.9]), 2, 0.2)
  assertAlmostEquals(predictGbm(model, [0.9, 0.1]), 0, 0.2)
  assertAlmostEquals(predictGbm(model, [0.1, 0.9]), 0, 0.2)
})

Deno.test('fitGbm - deterministic for a seed; constant target predicts the constant', () => {
  const X = Array.from({ length: 100 }, (_, i) => [i, i % 7])
  const y = X.map(([a, b]) => a / 10 + b)
  assertEquals(fitGbm(X, y, { seed: 3 }), fitGbm(X, y, { seed: 3 }))
  const flat = fitGbm(X, X.map(() => 4))
  assertEquals(predictGbm(flat, [50, 3]), 4)
  assert(flat.trees.length > 0)
})

Deno.test('fitGbm - rejects an empty training set', () => {
  assertThrows(() => fitGbm([], []))
})
