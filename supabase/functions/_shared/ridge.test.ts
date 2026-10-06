/**
 * Unit tests for standardized ridge regression and its time-ordered penalty
 * search. Pure -- synthetic data only, no database.
 */

import { assert, assertAlmostEquals, assertEquals, assertThrows } from '@std/assert'
import {
  DEFAULT_RIDGE_LAMBDAS,
  fitRidge,
  fitRidgeWithPenaltySearch,
  predictRidge,
  searchRidgePenalty,
  timeOrderedFolds,
} from './ridge.ts'
import { seededRandom as rng } from './projection-synthetic.ts'

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
}

function linearData(n: number, coefficients: number[], intercept: number, noise: number, seed = 1) {
  const random = rng(seed)
  const X: number[][] = []
  const y: number[] = []
  for (let i = 0; i < n; i++) {
    const x = coefficients.map(() => gaussian(random) * 3 + 1)
    X.push(x)
    y.push(intercept + x.reduce((sum, v, j) => sum + v * coefficients[j], 0) + noise * gaussian(random))
  }
  return { X, y }
}

Deno.test('fitRidge - recovers noiseless coefficients at a tiny penalty', () => {
  const { X, y } = linearData(200, [2, -1, 0.5], 4, 0)
  const model = fitRidge(X, y, 1e-9)
  assertAlmostEquals(model.intercept, 4, 1e-5)
  assertAlmostEquals(model.coefficients[0], 2, 1e-6)
  assertAlmostEquals(model.coefficients[1], -1, 1e-6)
  assertAlmostEquals(model.coefficients[2], 0.5, 1e-6)
  assertAlmostEquals(predictRidge(model, [1, 1, 1]), 5.5, 1e-5)
})

Deno.test('fitRidge - a large penalty shrinks every slope toward zero and the intercept to the mean', () => {
  const { X, y } = linearData(200, [2, -1], 4, 0.5)
  const model = fitRidge(X, y, 1e6)
  const meanY = y.reduce((a, b) => a + b, 0) / y.length
  for (const c of model.coefficients) assert(Math.abs(c) < 1e-4)
  assertAlmostEquals(predictRidge(model, X[0]), meanY, 1e-2)
})

Deno.test('fitRidge - standardization makes the fit independent of a column\'s units', () => {
  const { X, y } = linearData(150, [1.5, -0.7], 0, 1, 7)
  const rescaled = X.map(([a, b]) => [a * 1000, b])
  const original = fitRidge(X, y, 0.05)
  const scaled = fitRidge(rescaled, y, 0.05)
  assertAlmostEquals(scaled.coefficients[0] * 1000, original.coefficients[0], 1e-9)
  assertAlmostEquals(scaled.coefficients[1], original.coefficients[1], 1e-9)
  assertAlmostEquals(predictRidge(scaled, rescaled[3]), predictRidge(original, X[3]), 1e-9)
})

Deno.test('fitRidge - a constant column gets a zero coefficient and does not break the solve', () => {
  const { X, y } = linearData(100, [1], 2, 0.1)
  const withConstant = X.map((x) => [...x, 5])
  const model = fitRidge(withConstant, y, 0.01)
  assertEquals(model.coefficients[1], 0)
})

Deno.test('fitRidge - duplicated columns share the weight instead of failing', () => {
  const { X, y } = linearData(100, [2], 0, 0)
  const duplicated = X.map(([a]) => [a, a])
  const model = fitRidge(duplicated, y, 1e-6)
  assertAlmostEquals(model.coefficients[0], model.coefficients[1], 1e-9)
  assertAlmostEquals(model.coefficients[0] + model.coefficients[1], 2, 1e-3)
})

Deno.test('fitRidge - fits on a row subset only', () => {
  const X = [[0], [1], [2], [100]]
  const y = [0, 2, 4, -1000]
  const model = fitRidge(X, y, 1e-9, [0, 1, 2])
  assertAlmostEquals(model.coefficients[0], 2, 1e-6)
})

Deno.test('fitRidge - rejects a non-positive penalty and an empty training set', () => {
  assertThrows(() => fitRidge([[1], [2]], [1, 2], 0))
  assertThrows(() => fitRidge([[1], [2]], [1, 2], 1, []))
})

Deno.test('timeOrderedFolds - every validation row is later than every training row', () => {
  const times = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10, 11, 12]
  const folds = timeOrderedFolds(times, 3, 0.5)
  assertEquals(folds.length, 3)
  for (const fold of folds) {
    const latestTrain = Math.max(...fold.train.map((i) => times[i]))
    const earliestValidate = Math.min(...fold.validate.map((i) => times[i]))
    assert(latestTrain < earliestValidate)
  }
  // Folds grow forward: each trains on everything before its block.
  assertEquals(folds[0].train.length, 6)
  assert(folds[2].train.length > folds[1].train.length)
})

Deno.test('timeOrderedFolds - rows released the same day never straddle a cut', () => {
  const times = [1, 2, 3, 4, 4, 4, 4, 5, 6, 7]
  for (const fold of timeOrderedFolds(times, 2, 0.4)) {
    const trainTimes = new Set(fold.train.map((i) => times[i]))
    for (const i of fold.validate) assert(!trainTimes.has(times[i]))
  }
})

Deno.test('searchRidgePenalty - prefers a small penalty when the signal is strong', () => {
  const { X, y } = linearData(300, [2, -1, 1], 0, 0.2, 3)
  const times = X.map((_, i) => i)
  const result = searchRidgePenalty(X, y, times)
  assertEquals(result.scores.length, DEFAULT_RIDGE_LAMBDAS.length)
  assert(result.lambda <= 1e-2, `chose ${result.lambda}`)
})

Deno.test('searchRidgePenalty - prefers a large penalty when the features are pure noise', () => {
  const random = rng(11)
  const X = Array.from({ length: 300 }, () => Array.from({ length: 15 }, () => gaussian(random)))
  const y = X.map(() => gaussian(random))
  const result = searchRidgePenalty(X, y, X.map((_, i) => i))
  assert(result.lambda >= 0.1, `chose ${result.lambda}`)
})

Deno.test('searchRidgePenalty - falls back to the median candidate with too few rows to fold', () => {
  const result = searchRidgePenalty([[1]], [1], [0], { lambdas: [0.1, 1, 10] })
  assertEquals(result.lambda, 1)
})

Deno.test('fitRidgeWithPenaltySearch - refits on every row at the chosen penalty', () => {
  const { X, y } = linearData(200, [1, 2], 3, 0.3, 5)
  const { model, search } = fitRidgeWithPenaltySearch(X, y, X.map((_, i) => i))
  assertEquals(model.lambda, search.lambda)
  const refit = fitRidge(X, y, search.lambda)
  assertEquals(model.coefficients, refit.coefficients)
})
