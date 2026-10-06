/**
 * Unit tests for fit-projection-model (handler.ts): the orchestration around
 * the pure model -- loading, the training-size floor, activation through the
 * RPC, and recomputing league movies' cached projections -- against the
 * in-memory mock client and a small synthetic corpus.
 */
import { assert, assertEquals, assertExists } from '@std/assert'
import { createMockDbClient, type MockDb, type Row } from './_mock-client.ts'
import { syntheticCorpus } from './projection-synthetic.ts'
import { DEFAULT_SHRINKAGE } from './projection-features.ts'
import type { ProjectionModel } from './projection-model.ts'
import type { CorpusFilm } from './projection-types.ts'
import { isPartial, runFitProjectionModel } from '../fit-projection-model/handler.ts'

const NOW = '2026-10-01T10:00:00.000Z'

const corpus = syntheticCorpus({ seed: 7, firstYear: 2015, lastYear: 2025, filmsPerYear: 60, asOf: '2026-10-01' })

/** A league movie: priority 100, unsettled, credited with corpus people. */
function leagueFilm(tmdbId: number, overrides: Partial<CorpusFilm> = {}): Row {
  const template = corpus.films[corpus.films.length - 1]
  return {
    ...template,
    tmdb_id: tmdbId,
    title: `League ${tmdbId}`,
    release_date: '2026-12-01',
    us_wide_date: '2026-12-01',
    effective_release_date: '2026-12-01',
    rt_critic: null,
    rt_critic_votes: null,
    rt_settled_at: null,
    priority: 100,
    ...overrides,
  }
}

const PERSON = corpus.credits.find((c) => c.role === 'director')!.tmdb_person_id

function makeDb(extra: Partial<MockDb> = {}): MockDb {
  return {
    film_corpus: [
      ...corpus.films.map((f) => ({ ...f })),
      leagueFilm(9001),
      leagueFilm(9002, { rt_critic: 88, rt_critic_votes: 24 }),
      leagueFilm(9003),
      // Settled league movie: its score is final, nothing to project.
      leagueFilm(9004, { rt_critic: 70, rt_critic_votes: 120, rt_settled_at: '2026-09-01T00:00:00Z' }),
    ],
    film_credits: [
      ...corpus.credits.map((c) => ({ ...c })),
      { tmdb_id: 9001, tmdb_person_id: PERSON, role: 'director', billing: null },
      { tmdb_id: 9002, tmdb_person_id: 777_777, role: 'director', billing: null },
    ],
    // 777777's prior films have not been seeded yet: 9002 is partial.
    film_people: [{ tmdb_person_id: PERSON, credits_fetched_at: NOW }, { tmdb_person_id: 777_777, credits_fetched_at: null }],
    film_collections: [],
    projection_models: [],
    movie_projections: [{ tmdb_id: 9003, model_version: 1, projected_rt: 50, frozen_at: '2026-09-02T00:00:00Z', actual_rt: 64 }],
    ...extra,
  }
}

function activation(version = 7) {
  const calls: Row[] = []
  return {
    calls,
    rpc: { activate_projection_model: (args?: Row) => (calls.push(args!), version) },
  }
}

Deno.test('fit-projection-model - fits, activates through the RPC, and recomputes league movies', async () => {
  const db = makeDb()
  const { calls, rpc } = activation(7)
  const result = await runFitProjectionModel(createMockDbClient(db, { rpc }), { now: NOW, minTrainingRows: 100 })

  if ('skipped' in result) throw new Error('expected a fit')
  assertEquals(result.model_version, 7)
  assertEquals(result.targets, 3) // 9001-9003; 9004 has settled
  assertEquals(result.frozen_skipped, 1)
  assertEquals(result.projected, 2)
  assertEquals(result.failed, 0)

  assertEquals(calls.length, 1)
  const model = calls[0].p_coefficients as ProjectionModel
  assertEquals(model.format, 1)
  assertEquals(calls[0].p_metrics, result.metrics)
  assertEquals(result.metrics.training_rows, result.training_rows)
  assert(result.metrics.calibration_rows > 0)
  assert(Number.isFinite(result.metrics.mae_rt) && Number.isFinite(result.metrics.baseline_mae_rt))
  assertEquals(result.metrics.search_shrinkage, false)

  const rows = new Map(db.movie_projections.map((r) => [r.tmdb_id, r]))
  const plain = rows.get(9001)
  assertExists(plain)
  assertEquals(plain.model_version, 7)
  assertEquals(plain.computed_at, NOW)
  assertEquals(plain.partial, false)
  assertEquals(plain.includes_early_reviews, false)
  assert(plain.projected_rt > 0 && plain.projected_rt < 100)
  assert(plain.range80_lo <= plain.range50_lo && plain.range50_hi <= plain.range80_hi)

  const early = rows.get(9002)
  assertExists(early)
  assertEquals(early.partial, true)
  assertEquals(early.includes_early_reviews, true)
  assertEquals([early.early_rt_score, early.early_rt_reviews], [88, 24])

  // The frozen row keeps what was projected before release.
  assertEquals(rows.get(9003), { tmdb_id: 9003, model_version: 1, projected_rt: 50, frozen_at: '2026-09-02T00:00:00Z', actual_rt: 64 })
  assertEquals(rows.has(9004), false)
})

Deno.test('fit-projection-model - too few settled films skips without touching the model', async () => {
  const db = makeDb()
  const { calls, rpc } = activation()
  const result = await runFitProjectionModel(createMockDbClient(db, { rpc }), { now: NOW, minTrainingRows: 1_000_000 })
  assertEquals('skipped' in result && result.skipped, 'insufficient_training_rows')
  assertEquals(calls.length, 0)
  assertEquals(db.movie_projections.length, 1)
})

Deno.test('fit-projection-model - refits from the active model\'s shrinkage', async () => {
  const first = activation(1)
  const db = makeDb()
  await runFitProjectionModel(createMockDbClient(db, { rpc: first.rpc }), { now: NOW, minTrainingRows: 100 })
  const previous = first.calls[0].p_coefficients as ProjectionModel
  const shrinkage = { director: 8, writers: 2, cast: 13, label: 1 }
  db.projection_models = [{
    version: 1,
    is_active: true,
    coefficients: { ...previous, regression: { ...previous.regression, shrinkage } },
  }]

  const second = activation(2)
  const result = await runFitProjectionModel(createMockDbClient(db, { rpc: second.rpc }), { now: NOW, minTrainingRows: 100 })
  if ('skipped' in result) throw new Error('expected a fit')
  assertEquals(result.metrics.shrinkage, shrinkage)
})

Deno.test('fit-projection-model - an unreadable active model falls back to the default shrinkage', async () => {
  const db = makeDb({ projection_models: [{ version: 1, is_active: true, coefficients: { format: 0 } }] })
  const { rpc } = activation(2)
  const result = await runFitProjectionModel(createMockDbClient(db, { rpc }), { now: NOW, minTrainingRows: 100 })
  if ('skipped' in result) throw new Error('expected a fit')
  assertEquals(result.metrics.shrinkage, { ...DEFAULT_SHRINKAGE })
})

Deno.test('fit-projection-model - a failed activation throws before any projection is written', async () => {
  const db = makeDb()
  const client = createMockDbClient(db)
  client.rpc = () => Promise.resolve({ data: null, error: { message: 'permission denied' } })
  let threw = false
  try {
    await runFitProjectionModel(client, { now: NOW, minTrainingRows: 100 })
  } catch (error) {
    threw = true
    assert(String(error).includes('permission denied'))
  }
  assert(threw)
  assertEquals(db.movie_projections.length, 1)
})

Deno.test('isPartial - unexpanded people or franchise make a projection partial', () => {
  const film = { ...corpus.films[0], collection_id: 55 } as CorpusFilm
  const credits = [{ tmdb_id: film.tmdb_id, tmdb_person_id: 1, role: 'director' as const, billing: null }]
  assertEquals(isPartial(film, credits, new Set(), new Set()), false)
  assertEquals(isPartial(film, credits, new Set([1]), new Set()), true)
  assertEquals(isPartial(film, credits, new Set(), new Set([55])), true)
})
