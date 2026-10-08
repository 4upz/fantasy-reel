/**
 * The projection backtest: forward-chaining over test years, the three
 * baselines, the gradient-boosted challenger, the ship-gate checks, and the
 * markdown report. Pure apart from what the caller passes in; the CLI in
 * scripts/backtest-projections.ts loads the corpus and writes the report.
 *
 * Honesty rules (see the plan's "Validation and ship gate"):
 * - Year Y is predicted by a fit on films released before 1 January of Y.
 * - Year Y's ranges are calibrated only from residuals of earlier chained
 *   years, never from Y itself.
 * - Track-record inputs use only films released before each target.
 */

import { fantasyPointsForTomatometer } from '../../supabase/functions/_shared/fantasy-points.ts'
import {
  buildCorpusIndex,
  featureVector,
  logitToRt,
  shrinkFactor,
} from '../../supabase/functions/_shared/projection-features.ts'
import {
  calibrationBins,
  type CalibrationBin,
  intervalCoverage,
  maxCalibrationError,
  meanAbsoluteError,
  median,
  spearman,
} from '../../supabase/functions/_shared/projection-metrics.ts'
import {
  assembleModel,
  calibrate,
  type ChainOptions,
  designMatrix,
  forwardChain,
  type ModelRow,
  projectFilm,
  type ProjectionModel,
  type Regression,
  trainingRows,
} from '../../supabase/functions/_shared/projection-model.ts'
import type { CorpusCredit, CorpusFilm } from '../../supabase/functions/_shared/projection-types.ts'
import { fitGbm, type GbmOptions, predictGbm } from './gbm.ts'

export interface BacktestOptions {
  /** First test year (default 2019). */
  firstTestYear?: number
  /** Last complete year (default: the year before `now`). */
  lastCompleteYear?: number
  now?: Date
  /** Lead times (days before release) for the range-width table. */
  leadDays?: readonly number[]
  fit?: ChainOptions
  /** false skips the challenger. */
  gbm?: GbmOptions | false
  /** Beat the linear model by more than this MAE to replace it (default 1.5). */
  challengerMargin?: number
}

/** One test film's predictions. */
export interface BacktestRecord {
  tmdb_id: number
  year: number
  actual: number
  projected: number
  range50: [number, number]
  range80: [number, number]
  p_rotten: number
  p_90: number
  expected_points: number
  coverage: number
  flat: number
  genre: number
  director: number
  gbm: number | null
}

export interface YearSummary {
  year: number
  n: number
  mae: number
  mae_flat: number
  mae_genre: number
  mae_director: number
  mae_gbm: number | null
  fp_mae: number
  fp_mae_point: number
  fp_mae_genre: number
  spearman: number
  coverage50: number
  coverage80: number
  lambda: number
  shrinkage: Regression['shrinkage']
  calibration_residuals: number
}

export interface GateCheck {
  check: string
  threshold: string
  value: string
  pass: boolean
}

export interface LeadTimeRow {
  lead_days: number
  n: number
  mae: number
  /** Share with a 50% range of 10 points or less (would show a range on the chip). */
  narrow_share: number
  insufficient_share: number
}

export interface BacktestResult {
  generated_at: string
  corpus: { films: number; credits: number; labelled: number }
  test_years: number[]
  skipped_years: number[]
  records: BacktestRecord[]
  years: YearSummary[]
  pooled: Omit<YearSummary, 'year' | 'lambda' | 'shrinkage' | 'calibration_residuals'>
  calibration: { p_rotten: CalibrationBin[]; p_90: CalibrationBin[] }
  lead_times: LeadTimeRow[]
  gates: GateCheck[]
  passed: boolean
  challenger: { mae: number | null; margin: number; replaces_linear: boolean }
  /** The latest test year's model, for inspection. */
  latest_model: ProjectionModel | null
}

const DEFAULT_LEADS = [0, 14, 60, 120]

const points = (rt: number) => fantasyPointsForTomatometer(Math.round(Math.min(100, Math.max(0, rt))))

function summarizeRecords(records: readonly BacktestRecord[]) {
  const actual = records.map((r) => r.actual)
  const actualPoints = actual.map(points)
  const gbm = records.every((r) => r.gbm != null) && records.length > 0
    ? meanAbsoluteError(records.map((r) => r.gbm!), actual)
    : null
  return {
    n: records.length,
    mae: meanAbsoluteError(records.map((r) => r.projected), actual),
    mae_flat: meanAbsoluteError(records.map((r) => r.flat), actual),
    mae_genre: meanAbsoluteError(records.map((r) => r.genre), actual),
    mae_director: meanAbsoluteError(records.map((r) => r.director), actual),
    mae_gbm: gbm,
    fp_mae: meanAbsoluteError(records.map((r) => r.expected_points), actualPoints),
    fp_mae_point: meanAbsoluteError(records.map((r) => points(r.projected)), actualPoints),
    fp_mae_genre: meanAbsoluteError(records.map((r) => points(r.genre)), actualPoints),
    spearman: spearman(records.map((r) => r.projected), actual),
    coverage50: intervalCoverage(records.map((r) => r.range50), actual),
    coverage80: intervalCoverage(records.map((r) => r.range80), actual),
  }
}

/** Director-only baseline: genre baseline plus the shrunk director deviation, unfitted. */
function directorOnly(row: ModelRow, regression: Regression): number {
  const record = row.raw.trackRecords.director
  const deviation = record ? shrinkFactor(record.n, regression.shrinkage.director) * record.mean : 0
  return logitToRt(row.raw.baseline + deviation)
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const num = (v: number | null, places = 2) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(places))

export function runBacktest(
  corpus: { films: readonly CorpusFilm[]; credits: readonly CorpusCredit[] },
  options: BacktestOptions = {},
): BacktestResult {
  const now = options.now ?? new Date()
  const lastComplete = options.lastCompleteYear ?? now.getUTCFullYear() - 1
  const firstTest = options.firstTestYear ?? 2019
  const index = buildCorpusIndex(corpus.films, corpus.credits)
  const rows = trainingRows(index, corpus.films).filter((r) => r.year <= lastComplete)
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  if (years.length < 2) throw new Error('backtest: need labelled films in at least two years')

  // Chain every year after the first (warm-up years feed calibration), then
  // keep the test years for scoring.
  const { predictions, fits } = forwardChain(rows, years.slice(1), options.fit)
  const wanted = years.filter((y) => y >= firstTest && y <= lastComplete)
  const records: BacktestRecord[] = []
  const yearSummaries: YearSummary[] = []
  const models = new Map<number, ProjectionModel>()
  const skipped: number[] = []
  const filmsById = new Map(corpus.films.map((f) => [f.tmdb_id, f]))

  for (const year of wanted) {
    const fit = fits.get(year)
    const earlier = predictions.filter((p) => p.row.year < year)
    if (!fit || earlier.length === 0) {
      skipped.push(year)
      continue
    }
    const train = rows.filter((r) => r.year < year)
    const model = assembleModel(fit, calibrate(earlier), {
      rows: train.length,
      first_year: years[0],
      last_year: year - 1,
      calibration_years: [...new Set(earlier.map((p) => p.row.year))],
    })
    models.set(year, model)
    const flat = median(train.map((r) => r.rt))
    let gbm: ReturnType<typeof fitGbm> | null = null
    if (options.gbm !== false) {
      const { X, y } = designMatrix(train, fit.shrinkage)
      gbm = fitGbm(X, y, options.gbm ?? {})
    }
    const yearRecords: BacktestRecord[] = []
    for (const p of predictions.filter((p) => p.row.year === year)) {
      const result = projectFilm(model, p.row.raw)
      const gbmRt = gbm
        ? logitToRt(p.row.raw.baseline + predictGbm(gbm, featureVector(p.row.raw, fit.shrinkage)))
        : null
      yearRecords.push({
        tmdb_id: p.row.raw.tmdb_id,
        year,
        actual: p.row.rt,
        projected: result.projected_rt,
        range50: result.range50,
        range80: result.range80,
        p_rotten: result.p_rotten,
        p_90: result.p_90,
        expected_points: result.expected_points,
        coverage: result.coverage,
        flat,
        genre: logitToRt(p.row.raw.baseline),
        director: directorOnly(p.row, fit),
        gbm: gbmRt,
      })
    }
    records.push(...yearRecords)
    yearSummaries.push({
      year,
      ...summarizeRecords(yearRecords),
      lambda: fit.lambda,
      shrinkage: fit.shrinkage,
      calibration_residuals: earlier.length,
    })
  }
  if (records.length === 0) throw new Error('backtest: no test year had a fit and earlier residuals')

  // Lead times: rebuild each test film's features as of L days before release.
  const leadTimes: LeadTimeRow[] = (options.leadDays ?? DEFAULT_LEADS).map((lead) => {
    const widths: number[] = []
    const errors: number[] = []
    let insufficient = 0
    for (const [year, model] of models) {
      const films = records.filter((r) => r.year === year).map((r) => filmsById.get(r.tmdb_id)!)
      for (const row of trainingRows(index, films, { leadDays: lead })) {
        const result = projectFilm(model, row.raw)
        widths.push(result.range50[1] - result.range50[0])
        errors.push(Math.abs(result.projected_rt - row.rt))
        if (result.coverage < 0.25) insufficient++
      }
    }
    return {
      lead_days: lead,
      n: widths.length,
      mae: errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length),
      narrow_share: widths.filter((w) => w <= 10).length / Math.max(1, widths.length),
      insufficient_share: insufficient / Math.max(1, widths.length),
    }
  })

  const pooled = summarizeRecords(records)
  const calibration = {
    p_rotten: calibrationBins(records.map((r) => r.p_rotten), records.map((r) => r.actual < 60)),
    p_90: calibrationBins(records.map((r) => r.p_90), records.map((r) => r.actual >= 90)),
  }
  const improvement = (pooled.mae_genre - pooled.mae) / pooled.mae_genre
  const worstYear = yearSummaries.reduce((worst, y) => {
    const gap = y.mae - y.mae_genre
    return !worst || gap > worst.gap ? { year: y.year, gap } : worst
  }, null as { year: number; gap: number } | null)!
  const calibrationError = Math.max(maxCalibrationError(calibration.p_rotten), maxCalibrationError(calibration.p_90))
  const gates: GateCheck[] = [
    {
      check: 'MAE (RT points) vs genre-year baseline',
      threshold: 'At least 15% lower',
      value: `${num(pooled.mae)} vs ${num(pooled.mae_genre)} (${pct(improvement)} lower)`,
      pass: improvement >= 0.15,
    },
    {
      check: 'MAE (fantasy points, standard rule) vs genre-year baseline',
      threshold: 'Lower',
      value: `${num(pooled.fp_mae)} vs ${num(pooled.fp_mae_genre)}`,
      pass: pooled.fp_mae < pooled.fp_mae_genre,
    },
    {
      check: 'Spearman rank correlation, pooled',
      threshold: '0.40 or higher',
      value: num(pooled.spearman),
      pass: pooled.spearman >= 0.4,
    },
    {
      check: 'Calibration of P(rotten) and P(90+), deciles',
      threshold: 'Every decile within 10 points',
      value: `worst ${(calibrationError * 100).toFixed(1)} pts (P(rotten) ${
        (maxCalibrationError(calibration.p_rotten) * 100).toFixed(1)
      }, P(90+) ${(maxCalibrationError(calibration.p_90) * 100).toFixed(1)})`,
      pass: calibrationError <= 0.1,
    },
    {
      check: '80% range coverage',
      threshold: 'Between 75% and 85%',
      value: pct(pooled.coverage80),
      pass: pooled.coverage80 >= 0.75 && pooled.coverage80 <= 0.85,
    },
    {
      check: '50% range coverage',
      threshold: 'Between 45% and 55%',
      value: pct(pooled.coverage50),
      pass: pooled.coverage50 >= 0.45 && pooled.coverage50 <= 0.55,
    },
    {
      check: 'Worst single test year',
      threshold: 'No worse than the genre-year baseline',
      value: `${worstYear.year}: ${worstYear.gap > 0 ? '+' : ''}${num(worstYear.gap)} MAE vs genre-year`,
      pass: yearSummaries.every((y) => y.mae <= y.mae_genre),
    },
  ]
  const margin = options.challengerMargin ?? 1.5
  const latestYear = Math.max(...models.keys())
  return {
    generated_at: now.toISOString(),
    corpus: { films: corpus.films.length, credits: corpus.credits.length, labelled: rows.length },
    test_years: yearSummaries.map((y) => y.year),
    skipped_years: skipped,
    records,
    years: yearSummaries,
    pooled,
    calibration,
    lead_times: leadTimes,
    gates,
    passed: gates.every((g) => g.pass),
    challenger: {
      mae: pooled.mae_gbm,
      margin,
      replaces_linear: pooled.mae_gbm != null && pooled.mae_gbm < pooled.mae - margin,
    },
    latest_model: models.get(latestYear) ?? null,
  }
}

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

export interface ReportMeta {
  source: string
  modelVersion?: number | null
  synthetic?: boolean
}

export function renderReport(result: BacktestResult, meta: ReportMeta): string {
  const date = result.generated_at.slice(0, 10)
  const lines: string[] = []
  lines.push(`# Projection backtest — ${date}${meta.synthetic ? ' (SYNTHETIC)' : ''}`)
  lines.push('')
  if (meta.synthetic) {
    lines.push('> Synthetic fixture corpus: this run tests the backtest itself and approves nothing.')
    lines.push('')
  }
  lines.push(`- Source: ${meta.source}`)
  lines.push(`- Model version approved: ${meta.modelVersion ?? 'none (not yet stored)'}`)
  lines.push(
    `- Corpus: ${result.corpus.films} films, ${result.corpus.credits} credits, ${result.corpus.labelled} with a settled label`,
  )
  lines.push(`- Test years: ${result.test_years.join(', ')}${
    result.skipped_years.length ? ` (skipped for lack of history: ${result.skipped_years.join(', ')})` : ''
  }`)
  lines.push(
    '- Method: forward-chaining (fit on films before 1 January of the test year), ranges calibrated only on earlier years\' residuals, features from earlier films only.',
  )
  lines.push('')
  lines.push(`## Gate: ${result.passed ? 'PASS' : 'FAIL'}`)
  lines.push('')
  lines.push(table(['Check', 'Threshold', 'Value', 'Result'], result.gates.map((g) => [g.check, g.threshold, g.value, g.pass ? 'PASS' : 'FAIL'])))
  lines.push('')
  lines.push(
    meta.synthetic
      ? 'Synthetic run: the result shows the backtest works, not that any model may ship.'
      : result.passed
      ? 'Every check passes: the display flag may be turned on with this model version.'
      : 'At least one check fails: the projection display stays off. The corpus, pre-release polling and analytics still ship.',
  )
  lines.push('')
  lines.push('## Per year')
  lines.push('')
  const yearRow = (label: string, s: Omit<YearSummary, 'year' | 'lambda' | 'shrinkage' | 'calibration_residuals'>) => [
    label,
    String(s.n),
    num(s.mae),
    num(s.mae_flat),
    num(s.mae_genre),
    num(s.mae_director),
    num(s.mae_gbm),
    num(s.fp_mae),
    num(s.fp_mae_genre),
    num(s.spearman),
    pct(s.coverage50),
    pct(s.coverage80),
  ]
  lines.push(table(
    ['Year', 'Films', 'MAE', 'Flat', 'Genre-year', 'Director', 'GBM', 'FP MAE', 'FP genre', 'Spearman', '50% cov', '80% cov'],
    [...result.years.map((y) => yearRow(String(y.year), y)), yearRow('**Pooled**', result.pooled)],
  ))
  lines.push('')
  lines.push(
    'MAE columns are in RT points; FP MAE compares expected points (standard rule) with actual points; FP genre applies the curve to the genre-year baseline. ' +
      `Expected-points MAE pooled ${num(result.pooled.fp_mae)}; the curve applied to the point estimate gives ${num(result.pooled.fp_mae_point)}.`,
  )
  lines.push('')
  lines.push('## Calibration (deciles)')
  lines.push('')
  const calibrationRows = (bins: CalibrationBin[]) =>
    bins.map((b, i) => [String(i + 1), String(b.n), pct(b.predicted), pct(b.observed), (Math.abs(b.observed - b.predicted) * 100).toFixed(1)])
  lines.push('**P(rotten)** (actual below 60%)')
  lines.push('')
  lines.push(table(['Decile', 'Films', 'Predicted', 'Observed', 'Gap (pts)'], calibrationRows(result.calibration.p_rotten)))
  lines.push('')
  lines.push('**P(90+)** (actual 90% or higher)')
  lines.push('')
  lines.push(table(['Decile', 'Films', 'Predicted', 'Observed', 'Gap (pts)'], calibrationRows(result.calibration.p_90)))
  lines.push('')
  lines.push('## Range width by lead time')
  lines.push('')
  lines.push(
    'Share of films whose 50% range is 10 points or narrower (the chip shows a range; wider shows "Low confidence"). ' +
      'Lead time is simulated by building features only from films released that many days before each target.',
  )
  lines.push('')
  lines.push(table(
    ['Lead time', 'Films', 'MAE', 'Range shown', 'Not enough history'],
    result.lead_times.map((l) => [
      l.lead_days === 0 ? 'Release day' : `${l.lead_days} days`,
      String(l.n),
      num(l.mae),
      pct(l.narrow_share),
      pct(l.insufficient_share),
    ]),
  ))
  lines.push('')
  lines.push('## Challenger (gradient-boosted trees)')
  lines.push('')
  lines.push(
    result.challenger.mae == null
      ? 'Not run.'
      : `Pooled MAE ${num(result.challenger.mae)} vs linear ${num(result.pooled.mae)}. ` +
        (result.challenger.replaces_linear
          ? `The challenger beats the linear model by more than ${result.challenger.margin} points: consider shipping it instead.`
          : `It does not beat the linear model by more than ${result.challenger.margin} points, so the explainable linear model stays.`),
  )
  lines.push('')
  lines.push('## Fitted settings per test year')
  lines.push('')
  lines.push(table(
    ['Year', 'Penalty (per row)', 'k director', 'k writers', 'k cast', 'k label', 'Calibration residuals'],
    result.years.map((y) => [
      String(y.year),
      y.lambda.toPrecision(3),
      String(y.shrinkage.director),
      String(y.shrinkage.writers),
      String(y.shrinkage.cast),
      String(y.shrinkage.label),
      String(y.calibration_residuals),
    ]),
  ))
  lines.push('')
  return lines.join('\n')
}

