/**
 * Unit tests for the projection model: fitting, forward chaining, conformal
 * calibration, outcome distributions, the early-review update, explanations,
 * the MovieProjection contract, and serialization. Pure -- synthetic data only.
 */

import { assert, assertAlmostEquals, assertEquals, assertThrows } from '@std/assert'
import { fantasyPointsForTomatometer } from './fantasy-points.ts'
import { buildCorpusIndex, FEATURE_KEYS, logit, logitToRt, rawFeatures } from './projection-features.ts'
import {
  assembleModel,
  bandFor,
  betaDistribution,
  calibrate,
  conformalInterval,
  contributions,
  deserializeProjectionModel,
  distributionMoments,
  distributionQuantile,
  earlyReviewPosterior,
  fitProjectionModel,
  fitRegression,
  forwardChain,
  fromProjectionRow,
  type ModelRow,
  predictLogit,
  type ProjectionModel,
  type ProjectionResult,
  projectFilm,
  type ResidualBand,
  residualDistribution,
  serializeProjectionModel,
  summarizeOutcomes,
  toMovieProjection,
  toProjectionRow,
  trainingRows,
} from './projection-model.ts'
import { syntheticCorpus } from './projection-synthetic.ts'

// One small synthetic corpus, fitted once and shared by the tests below.
const corpus = syntheticCorpus({ filmsPerYear: 90, firstYear: 2012, lastYear: 2022, seed: 3 })
const index = buildCorpusIndex(corpus.films, corpus.credits)
const rows = trainingRows(index, corpus.films)
let fitted: { model: ProjectionModel; chain: ReturnType<typeof fitProjectionModel>['chain'] } | null = null
function fittedModel() {
  fitted ??= fitProjectionModel(rows, { calibrationYears: [2018, 2019, 2020, 2021, 2022] })
  return fitted
}

function uniformBand(n: number, spread: number): ResidualBand {
  const quantiles = Array.from({ length: n }, (_, i) => -spread + (2 * spread * (i + 0.5)) / n)
  return { min_coverage: 0, n, quantiles }
}

function pointMass(rt: number): Float64Array {
  const dist = new Float64Array(101)
  dist[rt] = 1
  return dist
}

Deno.test('trainingRows - keeps only settled, dated, scored films', () => {
  const settled = corpus.films.filter((f) => f.rt_settled_at && f.rt_critic != null)
  assertEquals(rows.length, settled.length)
  const unsettled = trainingRows(index, corpus.films, { requireSettled: false })
  assert(unsettled.length >= rows.length)
  for (const row of rows.slice(0, 20)) assertEquals(row.year, new Date(row.day * 86_400_000).getUTCFullYear())
})

Deno.test('fitRegression - finds the director effect and picks k from the grid', () => {
  const fit = fitRegression(rows.filter((r) => r.year < 2020), { shrinkageGrid: [1, 3, 8] })
  const director = fit.coefficients[FEATURE_KEYS.indexOf('director_dev')]
  assert(director > 0.3, `director coefficient ${director}`)
  for (const k of Object.values(fit.shrinkage)) assert([1, 3, 8].includes(k))
  // Documentary (+0.7 in the fixture) should beat horror (-0.45) on top of the baseline.
  assert(fit.coefficients[FEATURE_KEYS.indexOf('genre_99')] > fit.coefficients[FEATURE_KEYS.indexOf('genre_27')])
})

Deno.test('fitRegression - fixed shrinkage when the search is off', () => {
  const fit = fitRegression(rows.slice(0, 300), { searchShrinkage: false })
  assertEquals(fit.shrinkage, { director: 3, writers: 3, cast: 3, label: 3 })
})

Deno.test('forwardChain - a test year never trains on itself or later', () => {
  const { predictions, fits } = forwardChain(rows, [2020], { searchShrinkage: false })
  assertEquals([...fits.keys()], [2020])
  assert(predictions.every((p) => p.row.year === 2020))
  // Rewriting every 2020+ outcome leaves the 2020 predictions unchanged.
  const tampered: ModelRow[] = rows.map((r) => (r.year >= 2020 ? { ...r, target: -r.target, rt: 100 - r.rt } : r))
  const again = forwardChain(tampered, [2020], { searchShrinkage: false })
  assertEquals(again.predictions.map((p) => p.prediction.z), predictions.map((p) => p.prediction.z))
})

Deno.test('forwardChain - skips a year without enough earlier films', () => {
  const { fits } = forwardChain(rows, [2012, 2013], { minTrainRows: 50, searchShrinkage: false })
  assertEquals([...fits.keys()], [2013])
})

Deno.test('calibrate - sparse bands borrow the pooled residuals; summaries are capped', () => {
  const residuals = [
    ...Array.from({ length: 500 }, (_, i) => ({ coverage: 0.6, residual: (i - 250) / 100 })),
    ...Array.from({ length: 10 }, () => ({ coverage: 0.1, residual: 9 })),
  ]
  const calibration = calibrate(residuals, { minBandSize: 40, maxQuantiles: 99 })
  assertEquals(calibration.bands.map((b) => b.min_coverage), [0, 0.25, 0.5])
  assertEquals(calibration.bands[0].n, 510) // 10 own residuals: pooled instead
  assertEquals(calibration.bands[2].n, 500)
  assertEquals(calibration.bands[2].quantiles.length, 99)
  assertEquals(bandFor(calibration, 0.3).min_coverage, 0.25)
  assertEquals(bandFor(calibration, 0.99).min_coverage, 0.5)
  assertThrows(() => calibrate([]))
})

Deno.test('conformalInterval - uses finite-sample ranks and opens a side it cannot rank', () => {
  const band = uniformBand(999, 2)
  const [lo, hi] = conformalInterval(0, band, 0.8)
  assertAlmostEquals(lo, logitToRt(-1.6), 0.1)
  assertAlmostEquals(hi, logitToRt(1.6), 0.1)
  const [lo50, hi50] = conformalInterval(0, band, 0.5)
  assert(lo50 > lo && hi50 < hi)
  // Three residuals cannot support an 80% range's upper rank (ceil(4 * 0.9) = 4 > 3).
  assertEquals(conformalInterval(0, uniformBand(3, 1), 0.8), [0, 100])
})

Deno.test('conformalInterval - the 80% range holds about 80% of draws from the same residuals', () => {
  let state = 9
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648)
  const residuals = Array.from({ length: 2000 }, () => Math.log(random() / (1 - random() + 1e-12) + 1e-12) * 0.3)
  const band = calibrate(residuals.slice(0, 1000).map((residual) => ({ coverage: 0.9, residual }))).bands[2]
  let inside = 0
  for (const r of residuals.slice(1000)) {
    const [lo, hi] = conformalInterval(0.4, band, 0.8)
    const rt = logitToRt(0.4 + r)
    if (rt >= lo && rt <= hi) inside++
  }
  assertAlmostEquals(inside / 1000, 0.8, 0.04)
})

Deno.test('residualDistribution - sums to 1, centred on the projection', () => {
  const dist = residualDistribution(logit(0.7), uniformBand(199, 0.5))
  assertAlmostEquals(dist.reduce((a, b) => a + b, 0), 1, 1e-9)
  assertAlmostEquals(distributionQuantile(dist, 0.5), 70, 0.6)
  assert(dist.every((p) => p >= 0))
})

Deno.test('summarizeOutcomes - expected points use the scoring curve under both rules', () => {
  const sure96 = summarizeOutcomes(pointMass(96))
  assertEquals(sure96.p_90, 1)
  assertEquals(sure96.p_rotten, 0)
  assertAlmostEquals(sure96.expected_points, 36, 1e-9)
  assertAlmostEquals(sure96.expected_points_double, 42, 1e-9)

  const coinFlip = new Float64Array(101)
  coinFlip[35] = 0.5
  coinFlip[84] = 0.5
  const mixed = summarizeOutcomes(coinFlip)
  assertAlmostEquals(mixed.p_rotten, 0.5, 1e-12)
  assertAlmostEquals(mixed.p_fresh, 0.5, 1e-12)
  assertAlmostEquals(mixed.expected_points, (fantasyPointsForTomatometer(35) + 24) / 2, 1e-9)
  // Not the curve at the mean: the curve flattens below 50.
  assert(Math.abs(mixed.expected_points - fantasyPointsForTomatometer(59.5)) > 1)
})

Deno.test('betaDistribution - normalized with the Beta mean', () => {
  const dist = betaDistribution(30, 10)
  assertAlmostEquals(dist.reduce((a, b) => a + b, 0), 1, 1e-9)
  assertAlmostEquals(distributionMoments(dist).mean, 0.75, 0.005)
})

Deno.test('earlyReviewPosterior - keeps the prior with no reviews and moves toward early scores', () => {
  const prior = residualDistribution(logit(0.6), uniformBand(199, 1))
  const priorMean = distributionMoments(prior).mean
  const none = earlyReviewPosterior(prior, { score: 95, reviews: 0 })
  assertAlmostEquals(distributionMoments(none.distribution).mean, priorMean, 0.01)

  const few = distributionMoments(earlyReviewPosterior(prior, { score: 95, reviews: 10 }).distribution).mean
  const many = distributionMoments(earlyReviewPosterior(prior, { score: 95, reviews: 200 }).distribution).mean
  assert(few > priorMean && many > few)
  assert(many > 0.9, `200 reviews at 95% leave the mean at ${many}`)
  // The discount: full-weight reviews move it further than half-weight ones.
  const fullWeight = distributionMoments(earlyReviewPosterior(prior, { score: 95, reviews: 10 }, 1).distribution).mean
  assert(fullWeight > few)
})

Deno.test('earlyReviewPosterior - the prior Beta matches the projection mean and spread', () => {
  const prior = residualDistribution(logit(0.7), uniformBand(199, 0.8))
  const { alpha, beta } = earlyReviewPosterior(prior, { score: 50, reviews: 0 })
  const { mean, variance } = distributionMoments(prior)
  assertAlmostEquals(alpha / (alpha + beta), mean, 1e-9)
  assertAlmostEquals((alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)), variance, 1e-9)
})

Deno.test('contributions - baseline plus every delta is the projection, signs kept', () => {
  const { model } = fittedModel()
  for (const row of rows.slice(-25)) {
    const prediction = predictLogit(model.regression, row.raw)
    const parts = contributions(row.raw, prediction)
    const total = logitToRt(prediction.baselineZ) + parts.reduce((s, c) => s + c.delta_rt, 0)
    assertAlmostEquals(total, logitToRt(prediction.z), 1e-9)
    for (const part of parts) assert(part.label.length > 0)
  }
})

Deno.test('projectFilm - ranges, probabilities and explanations are consistent', () => {
  const { model } = fittedModel()
  for (const row of rows.slice(-40)) {
    const p = projectFilm(model, row.raw, { computedAt: '2026-10-06T00:00:00Z' })
    assert(p.range80[0] <= p.range50[0] && p.range50[0] <= p.projected_rt + 0.1)
    assert(p.projected_rt - 0.1 <= p.range50[1] && p.range50[1] <= p.range80[1])
    assertAlmostEquals(p.p_rotten + p.p_fresh, 1, 0.0011)
    assert(p.p_90 >= 0 && p.p_90 <= p.p_fresh + 1e-9)
    assert(p.expected_points_double >= p.expected_points)
    // Rounded parts still add up exactly to the rounded headline.
    const sum = p.baseline_rt + p.contributions.reduce((s, c) => s + c.delta_rt, 0)
    assertAlmostEquals(sum, p.projected_rt, 1e-9)
    assertEquals(p.includes_early_reviews, false)
    assertEquals(p.early_rt, null)
    assertEquals(p.computed_at, '2026-10-06T00:00:00Z')
  }
})

Deno.test('projectFilm - early reviews narrow the range and are credited as a contribution', () => {
  const { model } = fittedModel()
  const raw = rows[rows.length - 1].raw
  const before = projectFilm(model, raw)
  const after = projectFilm(model, raw, { early: { score: 92, reviews: 60 } })
  assertEquals(after.includes_early_reviews, true)
  assertEquals(after.early_rt, { score: 92, reviews: 60 })
  assert(after.range50[1] - after.range50[0] < before.range50[1] - before.range50[0])
  assert(after.projected_rt > before.projected_rt || before.projected_rt > 88)
  const early = after.contributions.find((c) => c.factor === 'early_reviews')
  assert(early, 'early reviews are credited')
  assertEquals(early.label, 'Early reviews (60)')
  assertAlmostEquals(after.baseline_rt + after.contributions.reduce((s, c) => s + c.delta_rt, 0), after.projected_rt, 1e-9)
  // Zero reviews is no evidence at all.
  assertEquals(projectFilm(model, raw, { early: { score: 92, reviews: 0 } }).includes_early_reviews, false)
})

const sample: ProjectionResult = {
  tmdb_id: 42,
  projected_rt: 71.4,
  range50: [64, 78.5],
  range80: [52, 86],
  p_rotten: 0.31,
  p_fresh: 0.69,
  p_90: 0.08,
  expected_points: 8.25,
  expected_points_double: 8.9,
  baseline_rt: 61,
  contributions: [{ factor: 'director', label: 'Director', delta_rt: 10.4 }],
  coverage: 0.2,
  partial: true,
  includes_early_reviews: false,
  early_rt: null,
  computed_at: '2026-10-06T00:00:00Z',
}

Deno.test('toMovieProjection - resolves the league rule and the display flags', () => {
  const standard = toMovieProjection(sample, false)
  assertEquals(standard.expected_points, 8.25)
  assertEquals(toMovieProjection(sample, true).expected_points, 8.9)
  assertEquals(standard.low_confidence, true) // 14.5-point 50% range
  assertEquals(standard.insufficient_history, true) // coverage 0.2
  assert(!('expected_points_double' in standard))
  const tight = toMovieProjection({ ...sample, range50: [66, 76], coverage: 0.25 }, false)
  assertEquals(tight.low_confidence, false) // exactly 10 points still shows a range
  assertEquals(tight.insufficient_history, false)
})

Deno.test('toProjectionRow / fromProjectionRow - round trip, numeric strings tolerated', () => {
  const row = toProjectionRow({ ...sample, includes_early_reviews: true, early_rt: { score: 88, reviews: 24 } }, 3)
  assertEquals(row.model_version, 3)
  assertEquals(row.p_club90, 0.08)
  assertEquals(row.early_rt_score, 88)
  const fromDb = { ...row, projected_rt: '71.4' as unknown as number, coverage: '0.20' as unknown as number }
  assertEquals(fromProjectionRow(fromDb), { ...sample, includes_early_reviews: true, early_rt: { score: 88, reviews: 24 } })
})

Deno.test('serializeProjectionModel - round trips to identical projections', () => {
  const { model } = fittedModel()
  const restored = deserializeProjectionModel(serializeProjectionModel(model))
  assertEquals(restored, model)
  const raw = rows[rows.length - 3].raw
  assertEquals(projectFilm(restored, raw, { computedAt: 'x' }), projectFilm(model, raw, { computedAt: 'x' }))
  // Also accepts the parsed jsonb object.
  assertEquals(deserializeProjectionModel(JSON.parse(serializeProjectionModel(model))), model)
})

Deno.test('deserializeProjectionModel - refuses other formats, feature sets and bad numbers', () => {
  const { model } = fittedModel()
  const json = JSON.parse(serializeProjectionModel(model))
  assertThrows(() => deserializeProjectionModel({ ...json, format: 2 }), Error, 'unsupported format')
  assertThrows(() => deserializeProjectionModel({ ...json, feature_keys: json.feature_keys.slice(1) }), Error, 'different feature set')
  assertThrows(
    () => deserializeProjectionModel({ ...json, regression: { ...json.regression, intercept: null } }),
    Error,
    'regression.intercept',
  )
  assertThrows(() => deserializeProjectionModel({ ...json, calibration: { bands: [] } }), Error, 'no bands')
  assertThrows(() => deserializeProjectionModel('null'), Error, 'not an object')
})

Deno.test('fitProjectionModel - calibrates on forward-chained residuals only', () => {
  const { model, chain } = fittedModel()
  assertEquals(model.training.calibration_years, [2018, 2019, 2020, 2021, 2022])
  assertEquals(model.training.rows, rows.length)
  assertEquals(chain.length, rows.filter((r) => r.year >= 2018).length)
  assertEquals(model.calibration.bands[0].n > 0, true)
  assertEquals(model.feature_keys, [...FEATURE_KEYS])
})

Deno.test('assembleModel + projectFilm - a film outside the corpus projects from credits passed in', () => {
  const { model } = fittedModel()
  const known = corpus.films[corpus.films.length - 1]
  const credits = corpus.credits.filter((c) => c.tmdb_id === known.tmdb_id)
  const upcoming = { ...known, tmdb_id: 1, rt_critic: null, rt_critic_votes: null, rt_settled_at: null, us_wide_date: '2023-06-01' }
  const raw = rawFeatures(index, upcoming, { credits })
  const projection = projectFilm(assembleModel(model.regression, model.calibration, model.training), raw)
  assertEquals(projection.tmdb_id, 1)
  assert(projection.coverage > 0)
})
