/**
 * End-to-end tests for the projection backtest and its CLI, on the synthetic
 * fixture corpus (no database). Run with:
 *   deno test -A --no-config scripts/projections/
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@^1.0.0'
import { syntheticCorpus } from '../../supabase/functions/_shared/projection-synthetic.ts'
import { main, normalizeFilm, parseCorpus, summaryJson } from '../backtest-projections.ts'
import { renderReport, runBacktest } from './backtest.ts'

const corpus = syntheticCorpus({ filmsPerYear: 70, firstYear: 2013, lastYear: 2022, seed: 11 })
const options = { lastCompleteYear: 2022, now: new Date('2026-10-06T00:00:00Z'), gbm: { trees: 40 } }
let cached: ReturnType<typeof runBacktest> | null = null
const result = () => (cached ??= runBacktest(corpus, options))

Deno.test('runBacktest - scores 2019 through the last complete year with honest calibration', () => {
  const r = result()
  assertEquals(r.test_years, [2019, 2020, 2021, 2022])
  for (const year of r.years) assert(year.n > 0 && year.calibration_residuals > 0)
  // Calibration residuals come only from chained years before each test year, so they grow.
  assert(r.years[1].calibration_residuals > r.years[0].calibration_residuals)
  assertEquals(r.records.length, r.pooled.n)
  assert(r.records.every((rec) => rec.year >= 2019 && rec.year <= 2022))
})

Deno.test('runBacktest - the model beats the flat and genre-year baselines on structured data', () => {
  const r = result()
  assert(r.pooled.mae < r.pooled.mae_genre, `${r.pooled.mae} vs ${r.pooled.mae_genre}`)
  assert(r.pooled.mae < r.pooled.mae_flat)
  assert(r.pooled.spearman > 0.3)
  assert(r.pooled.coverage80 > r.pooled.coverage50)
})

Deno.test('runBacktest - reports every gate from the plan and the challenger verdict', () => {
  const r = result()
  assertEquals(r.gates.map((g) => g.check), [
    'MAE (RT points) vs genre-year baseline',
    'MAE (fantasy points, standard rule) vs genre-year baseline',
    'Spearman rank correlation, pooled',
    'Calibration of P(rotten) and P(90+), deciles',
    '80% range coverage',
    '50% range coverage',
    'Worst single test year',
  ])
  assertEquals(r.passed, r.gates.every((g) => g.pass))
  assertEquals(r.calibration.p_rotten.length, 10)
  assertEquals(r.calibration.p_90.length, 10)
  assert(r.challenger.mae != null)
  assertEquals(r.challenger.replaces_linear, r.challenger.mae! < r.pooled.mae - 1.5)
  assertEquals(r.lead_times.map((l) => l.lead_days), [0, 14, 60, 120])
  assert(r.lead_times.every((l) => l.narrow_share >= 0 && l.narrow_share <= 1))
  assert(r.latest_model != null)
})

Deno.test('runBacktest - films after the last complete year are left out', () => {
  const r = runBacktest(corpus, { ...options, lastCompleteYear: 2020, gbm: false })
  assertEquals(r.test_years, [2019, 2020])
  assertEquals(r.challenger.mae, null)
})

Deno.test('runBacktest - refuses a corpus with too little history', () => {
  const tiny = syntheticCorpus({ filmsPerYear: 5, firstYear: 2020, lastYear: 2020 })
  assertThrows(() => runBacktest(tiny, { lastCompleteYear: 2020 }), Error, 'at least two years')
})

Deno.test('renderReport - gate table, per-year table, calibration, lead time, challenger', () => {
  const report = renderReport(result(), { source: 'test', modelVersion: 7 })
  assertStringIncludes(report, '# Projection backtest — 2026-10-06')
  assertStringIncludes(report, `## Gate: ${result().passed ? 'PASS' : 'FAIL'}`)
  assertStringIncludes(report, '| MAE (RT points) vs genre-year baseline | At least 15% lower |')
  assertStringIncludes(report, '| **Pooled** |')
  assertStringIncludes(report, '**P(90+)**')
  assertStringIncludes(report, '| Release day |')
  assertStringIncludes(report, 'Model version approved: 7')
  assertStringIncludes(report, '## Challenger (gradient-boosted trees)')
  const synthetic = renderReport(result(), { source: 'fixture', synthetic: true })
  assertStringIncludes(synthetic, '(SYNTHETIC)')
  assertStringIncludes(synthetic, 'approves nothing')
})

Deno.test('parseCorpus - JSON export and NDJSON rows', () => {
  const film = corpus.films[0]
  const credit = corpus.credits[0]
  const json = parseCorpus(JSON.stringify({ films: [film], credits: [credit] }), 'corpus.json')
  assertEquals(json, { films: [film], credits: [credit] })
  const ndjson = parseCorpus(`${JSON.stringify(film)}\n\n${JSON.stringify(credit)}\n`, 'corpus.ndjson')
  assertEquals(ndjson, { films: [film], credits: [credit] })
  assertThrows(() => parseCorpus('{"rows": []}', 'x.json'), Error, 'expected')
})

Deno.test('normalizeFilm - fills columns an older corpus lacks', () => {
  const film = normalizeFilm({ tmdb_id: '5', title: 'Old', release_date: '2015-02-01', rt_critic: '71', genre_ids: [18] })
  assertEquals(film.tmdb_id, 5)
  assertEquals(film.rt_critic, 71)
  assertEquals(film.keyword_flags, [])
  assertEquals(film.us_wide_date, null)
  assertEquals(film.label_id, null)
})

Deno.test('main - synthetic mode runs end to end and writes the report and JSON summary', async () => {
  const dir = await Deno.makeTempDir()
  const out = `${dir}/report.md`
  const json = `${dir}/summary.json`
  const { result: r, reportPath, exitCode } = await main([
    '--synthetic',
    '--films-per-year',
    '60',
    '--no-gbm',
    '--out',
    out,
    '--json',
    json,
  ])
  assertEquals(reportPath, out)
  assertEquals(exitCode, 0)
  const report = await Deno.readTextFile(out)
  assertStringIncludes(report, '(SYNTHETIC)')
  const summary = JSON.parse(await Deno.readTextFile(json))
  assertEquals(summary.gates.length, 7)
  assertEquals('records' in summary, false)
  assertEquals(summaryJson(r).passed, r.passed)
})

Deno.test('main - --input reads an exported corpus; --strict fails a failing gate', async () => {
  const dir = await Deno.makeTempDir()
  // Pure noise: no model can pass the gate.
  const noise = syntheticCorpus({ filmsPerYear: 50, firstYear: 2014, lastYear: 2021, noise: 3, seed: 2 })
  const input = `${dir}/corpus.json`
  await Deno.writeTextFile(input, JSON.stringify(noise))
  const { result: r, exitCode } = await main([
    '--input',
    input,
    '--last-year',
    '2021',
    '--no-gbm',
    '--strict',
    '--out',
    `${dir}/r.md`,
  ])
  assertEquals(r.corpus.films, noise.films.length)
  assertEquals(r.passed, false)
  assertEquals(exitCode, 1)
})

Deno.test('main - requires exactly one corpus source', async () => {
  let message = ''
  try {
    await main(['--synthetic', '--supabase'])
  } catch (error) {
    message = (error as Error).message
  }
  assertStringIncludes(message, 'exactly one')
})
