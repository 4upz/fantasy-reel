/**
 * Core logic for fit-projection-model, separate from index.ts so unit tests
 * can import it without triggering Deno.serve().
 *
 * One run (monthly):
 *   1. load the whole corpus (film_corpus + film_credits, paged);
 *   2. fit the model on settled films (`fitProjectionModel`: forward-chained
 *      calibration years for honest residuals, then a final fit on every row);
 *   3. store it as the next projection_models version and make it the only
 *      active one (`activate_projection_model`, one transaction);
 *   4. recompute movie_projections for league movies (film_corpus priority
 *      100) whose score has not settled, skipping frozen rows.
 *
 * Spends no MDBList or TMDb quota: everything it reads is already in the
 * corpus. The model itself is pure (`_shared/projection-model.ts`); this file
 * only loads rows and stores what it returns.
 */
import { createLogger, serializeError } from '../_shared/logger.ts'
import { loadCorpus, selectAll } from '../_shared/projection-corpus.ts'
import { buildCorpusIndex, logitToRt, rawFeatures } from '../_shared/projection-features.ts'
import { meanAbsoluteError, spearman } from '../_shared/projection-metrics.ts'
import {
  type ChainPrediction,
  deserializeProjectionModel,
  fitProjectionModel,
  type MovieProjectionRow,
  projectFilm,
  type ProjectionModel,
  toProjectionRow,
  trainingRows,
} from '../_shared/projection-model.ts'
import type { CorpusCredit, CorpusFilm } from '../_shared/projection-types.ts'

const log = createLogger('fit-projection-model')

/** ingest-film-corpus's priority for movies on a roster or an active wishlist. */
export const LEAGUE_PRIORITY = 100

/** Below this many settled films the fit is noise: skip, keep the current model. */
export const DEFAULT_MIN_TRAINING_ROWS = 500

/** Ids per `.in()` filter, to keep request URLs short. */
const IN_CHUNK = 200
/** Rows per movie_projections upsert. */
const UPSERT_CHUNK = 200

type DbError = { message: string } | null
type Rows = { data: unknown[] | null; error: DbError }

/** The select builder methods this job uses; a real PostgREST builder has them all. */
interface FitQuery extends PromiseLike<Rows> {
  eq(column: string, value: unknown): FitQuery
  gte(column: string, value: unknown): FitQuery
  in(column: string, values: unknown[]): FitQuery
  is(column: string, value: null): FitQuery
  not(column: string, op: 'is', value: null): FitQuery
  order(column: string): FitQuery
  range(from: number, to: number): PromiseLike<Rows>
  maybeSingle(): PromiseLike<{ data: unknown; error: DbError }>
}

/**
 * Structural client slice so this module needs no esm.sh type import; it is a
 * `CorpusClient` too. Pass a real SupabaseClient through `asFitClient`
 * (supabase-js's generic builders trip TS2589 against a narrow type).
 */
export interface FitClient {
  from(table: string): {
    select(columns: string): FitQuery
    upsert(rows: Record<string, unknown>[], options: { onConflict: string }): PromiseLike<{ error: DbError }>
  }
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>
}

export function asFitClient(client: { from: unknown; rpc: unknown }): FitClient {
  return client as unknown as FitClient
}

export interface FitConfig {
  /** ISO timestamp stamped as computed_at; injected so tests are deterministic. */
  now: string
  minTrainingRows?: number
  /**
   * Re-search each factor's shrinkage k (several times the CPU of a plain
   * refit). Off by default: the job starts from the active model's k, which
   * the backtest chose.
   */
  searchShrinkage?: boolean
}

export interface FitError {
  stage: string
  id?: number
  error: unknown
}

export type FitResult =
  | { skipped: 'insufficient_training_rows'; training_rows: number; min_training_rows: number }
  | {
    model_version: number
    training_rows: number
    metrics: FitMetrics
    targets: number
    projected: number
    frozen_skipped: number
    failed: number
    errors: FitError[]
  }

/** Stored as projection_models.metrics: honest, forward-chained accuracy of this fit. */
export interface FitMetrics {
  training_rows: number
  first_year: number
  last_year: number
  calibration_years: number[]
  calibration_rows: number
  /** Forward-chained MAE in RT points. */
  mae_rt: number
  /** The genre baseline alone, on the same rows: what the model must beat. */
  baseline_mae_rt: number
  spearman: number
  shrinkage: ProjectionModel['regression']['shrinkage']
  lambda: number
  search_shrinkage: boolean
}

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places

/** projection_models.metrics for one fit. Pure. */
export function fitMetrics(model: ProjectionModel, chain: readonly ChainPrediction[], searchShrinkage: boolean): FitMetrics {
  const actual = chain.map((p) => p.row.rt)
  const predicted = chain.map((p) => logitToRt(p.prediction.z))
  const baseline = chain.map((p) => logitToRt(p.prediction.baselineZ))
  const { rows, first_year, last_year, calibration_years } = model.training
  return {
    training_rows: rows,
    first_year,
    last_year,
    calibration_years,
    calibration_rows: chain.length,
    mae_rt: round(meanAbsoluteError(predicted, actual)),
    baseline_mae_rt: round(meanAbsoluteError(baseline, actual)),
    spearman: round(spearman(predicted, actual)),
    shrinkage: model.regression.shrinkage,
    lambda: model.regression.lambda,
    search_shrinkage: searchShrinkage,
  }
}

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

/** The active model's shrinkage, to start the refit from; null when none is usable. */
async function activeShrinkage(client: FitClient): Promise<ProjectionModel['regression']['shrinkage'] | null> {
  const { data, error } = await client.from('projection_models').select('coefficients').eq('is_active', true).maybeSingle()
  if (error || !data) return null
  try {
    return deserializeProjectionModel((data as { coefficients: unknown }).coefficients).regression.shrinkage
  } catch (err) {
    // A model fitted for an older feature set: refit from the defaults.
    log.warn('Active projection model unreadable; refitting from default shrinkage', { error: serializeError(err) })
    return null
  }
}

/** The `column` values `query` returns for `ids`, queried in URL-safe chunks. */
async function idsWhere(
  ids: readonly number[],
  query: (chunk: number[]) => PromiseLike<Rows>,
  column: string,
): Promise<Set<number>> {
  const found = new Set<number>()
  for (const chunk of chunks(ids, IN_CHUNK)) {
    const { data, error } = await query(chunk)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Record<string, unknown>[]) found.add(Number(row[column]))
  }
  return found
}

/**
 * Whether a film's projection is still waiting on ingestion: one of its
 * director / writers / top-3 cast has not had their prior films seeded yet, or
 * its franchise's parts have not. Pure.
 */
export function isPartial(
  film: CorpusFilm,
  credits: readonly CorpusCredit[],
  unexpandedPeople: ReadonlySet<number>,
  unexpandedCollections: ReadonlySet<number>,
): boolean {
  if (film.collection_id != null && unexpandedCollections.has(film.collection_id)) return true
  return credits.some((c) => unexpandedPeople.has(c.tmdb_person_id))
}

/** An early Tomatometer the projection should be updated with, if the row has one. */
function earlyReviews(film: CorpusFilm) {
  return film.rt_critic != null && film.rt_critic_votes != null && film.rt_critic_votes > 0
    ? { score: film.rt_critic, reviews: film.rt_critic_votes }
    : null
}

export async function runFitProjectionModel(client: FitClient, config: FitConfig): Promise<FitResult> {
  const minTrainingRows = config.minTrainingRows ?? DEFAULT_MIN_TRAINING_ROWS
  const searchShrinkage = config.searchShrinkage ?? false

  const [{ films, credits }, shrinkage] = await Promise.all([loadCorpus(client), activeShrinkage(client)])
  const index = buildCorpusIndex(films, credits)
  const rows = trainingRows(index, films)
  if (rows.length < minTrainingRows) {
    log.info('Not enough settled films to fit; keeping the current model', { training_rows: rows.length })
    return { skipped: 'insufficient_training_rows', training_rows: rows.length, min_training_rows: minTrainingRows }
  }

  const { model, chain } = fitProjectionModel(rows, { searchShrinkage, shrinkage: shrinkage ?? undefined })
  const metrics = fitMetrics(model, chain, searchShrinkage)

  const { data: version, error: activateError } = await client.rpc('activate_projection_model', {
    p_coefficients: model,
    p_metrics: metrics,
  })
  if (activateError || typeof version !== 'number') {
    throw new Error(`activate_projection_model failed: ${activateError?.message ?? 'no version returned'}`)
  }
  log.info('Projection model activated', { model_version: version, training_rows: rows.length, mae_rt: metrics.mae_rt })

  // League movies still in play: a settled score is final, nothing to project.
  const targetIds = (await selectAll(
    client,
    'film_corpus',
    'tmdb_id',
    ['tmdb_id'],
    (q) => q.gte('priority', LEAGUE_PRIORITY).is('rt_settled_at', null),
  )).map((r) => Number(r.tmdb_id))
  const filmsById = new Map(films.map((f) => [f.tmdb_id, f]))
  const targets = targetIds.map((id) => filmsById.get(id)).filter((f): f is CorpusFilm => f != null)

  // Frozen rows record what was projected before release; never rewrite them.
  const frozen = await idsWhere(
    targetIds,
    (chunk) => client.from('movie_projections').select('tmdb_id').in('tmdb_id', chunk).not('frozen_at', 'is', null),
    'tmdb_id',
  )
  const creditsOf = (film: CorpusFilm) => index.creditsByFilm.get(film.tmdb_id) ?? []
  const live = targets.filter((f) => !frozen.has(f.tmdb_id))
  const personIds = [...new Set(live.flatMap((f) => creditsOf(f).map((c) => c.tmdb_person_id)))]
  const collectionIds = [...new Set(live.map((f) => f.collection_id).filter((id): id is number => id != null))]
  const [unexpandedPeople, unexpandedCollections] = await Promise.all([
    idsWhere(
      personIds,
      (chunk) =>
        client.from('film_people').select('tmdb_person_id').in('tmdb_person_id', chunk).is('credits_fetched_at', null),
      'tmdb_person_id',
    ),
    idsWhere(
      collectionIds,
      (chunk) =>
        client.from('film_collections').select('collection_id').in('collection_id', chunk).is('parts_fetched_at', null),
      'collection_id',
    ),
  ])

  const errors: FitError[] = []
  const projectionRows: MovieProjectionRow[] = []
  for (const film of live) {
    try {
      const result = projectFilm(model, rawFeatures(index, film), {
        early: earlyReviews(film),
        partial: isPartial(film, creditsOf(film), unexpandedPeople, unexpandedCollections),
        computedAt: config.now,
      })
      projectionRows.push(toProjectionRow(result, version))
    } catch (err) {
      errors.push({ stage: 'project', id: film.tmdb_id, error: serializeError(err) })
    }
  }

  let projected = 0
  for (const chunk of chunks(projectionRows, UPSERT_CHUNK)) {
    const { error } = await client.from('movie_projections').upsert(chunk as unknown as Record<string, unknown>[], {
      onConflict: 'tmdb_id',
    })
    if (error) errors.push({ stage: 'upsert', error: error.message })
    else projected += chunk.length
  }

  return {
    model_version: version,
    training_rows: rows.length,
    metrics,
    targets: targets.length,
    projected,
    frozen_skipped: targets.length - live.length,
    failed: live.length - projected,
    errors,
  }
}
