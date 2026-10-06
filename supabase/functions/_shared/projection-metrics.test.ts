/** Unit tests for projection accuracy and calibration metrics. Pure. */

import { assertAlmostEquals, assertEquals, assertThrows } from '@std/assert'
import {
  calibrationBins,
  intervalCoverage,
  maxCalibrationError,
  meanAbsoluteError,
  median,
  spearman,
} from './projection-metrics.ts'

Deno.test('meanAbsoluteError - averages absolute gaps', () => {
  assertEquals(meanAbsoluteError([1, 5, 10], [2, 3, 10]), 1)
  assertEquals(Number.isNaN(meanAbsoluteError([], [])), true)
  assertThrows(() => meanAbsoluteError([1], [1, 2]))
})

Deno.test('spearman - perfect, reversed, tied and constant inputs', () => {
  assertAlmostEquals(spearman([1, 2, 3, 4], [10, 20, 30, 1000]), 1, 1e-12)
  assertAlmostEquals(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-12)
  // Ties share average ranks: ranks (1.5, 1.5, 3) vs (1, 2, 3).
  assertAlmostEquals(spearman([5, 5, 9], [1, 2, 3]), 0.8660254037844387, 1e-12)
  assertEquals(Number.isNaN(spearman([1, 1, 1], [1, 2, 3])), true)
})

Deno.test('calibrationBins - equal-count bins sorted by prediction', () => {
  const predicted = Array.from({ length: 100 }, (_, i) => i / 100)
  const happened = predicted.map((p) => p >= 0.5)
  const bins = calibrationBins(predicted, happened)
  assertEquals(bins.length, 10)
  assertEquals(bins.every((b) => b.n === 10), true)
  assertAlmostEquals(bins[0].predicted, 0.045, 1e-12)
  assertEquals(bins[0].observed, 0)
  assertEquals(bins[9].observed, 1)
  assertAlmostEquals(maxCalibrationError(bins), 0.455, 1e-9) // the 50-59 bin: predicted 0.545, all happened
})

Deno.test('calibrationBins - fewer predictions than bins drops the empty ones', () => {
  assertEquals(calibrationBins([0.2, 0.8], [false, true], 10).length, 2)
})

Deno.test('intervalCoverage - counts outcomes inside inclusive ranges', () => {
  assertEquals(intervalCoverage([[0, 10], [5, 6], [1, 2]], [10, 7, 1]), 2 / 3)
})

Deno.test('median - odd, even and empty', () => {
  assertEquals(median([3, 1, 2]), 2)
  assertEquals(median([4, 1, 2, 3]), 2.5)
  assertEquals(Number.isNaN(median([])), true)
})
