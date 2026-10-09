/**
 * Unit tests for get-movie-projections (handler.ts), against the in-memory
 * mock client and a stub authenticator: auth, validation, membership, the
 * projections_display gate, and how cached rows are served.
 */
import { assertEquals, assertExists } from '@std/assert'
import { createMockDbClient, type MockDb, type Row } from './_mock-client.ts'
import { clearFlagCache } from './feature-flags.ts'
import { handleGetMovieProjections, MAX_TMDB_IDS, type ProjectionsDeps } from '../get-movie-projections/handler.ts'
import type { GetMovieProjectionsResponse } from './projection-types.ts'

const LEAGUE_ID = 'f9411797-9e6e-4410-9e35-c4b1edc0f912'
const SERIES_ID = '86de1055-23a7-4cf3-be5c-5806d029dabe'
const OTHER_SERIES_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const USER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
const TODAY = '2026-10-06'

function projectionRow(tmdbId: number, overrides: Row = {}): Row {
  return {
    tmdb_id: tmdbId,
    model_version: 3,
    // PostgREST returns numeric columns as strings.
    projected_rt: '72.4',
    range50_lo: '66.0',
    range50_hi: '79.0',
    range80_lo: '55.5',
    range80_hi: '86.0',
    p_rotten: '0.180',
    p_fresh: '0.820',
    p_club90: '0.090',
    expected_points: '11.20',
    expected_points_double: '12.05',
    baseline_rt: '61.0',
    factors: [
      { factor: 'director', label: 'Director', delta_rt: 8.4 },
      { factor: 'genre_month', label: 'October release', delta_rt: 3 },
    ],
    coverage: '0.60',
    partial: false,
    includes_early_reviews: false,
    early_rt_score: null,
    early_rt_reviews: null,
    computed_at: '2026-10-01T10:00:00.000Z',
    frozen_at: null,
    actual_rt: null,
    ...overrides,
  }
}

interface Setup {
  flag?: Row | null
  league?: Row
  member?: boolean
  db?: MockDb
}

function makeDb({ flag, league, member = true, db = {} }: Setup = {}): MockDb {
  clearFlagCache()
  return {
    feature_flags: flag === null ? [] : [{
      key: 'projections_display',
      enabled: true,
      config: { series_ids: [SERIES_ID] },
      ...flag,
    }],
    leagues: [{ id: LEAGUE_ID, series_id: SERIES_ID, double_points_over_90: false, ...league }],
    league_participants: member ? [{ id: 'p1', league_id: LEAGUE_ID, user_id: USER_ID, status: 'active' }] : [],
    movie_projections: [projectionRow(101)],
    movies: [],
    ...db,
  }
}

function request(body: unknown): Request {
  return new Request('http://localhost/functions/v1/get-movie-projections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-jwt' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const signedIn: ProjectionsDeps['authenticate'] = () => Promise.resolve({ userId: USER_ID })

async function call(db: MockDb, body: unknown = { league_id: LEAGUE_ID, tmdb_ids: [101] }, authenticate = signedIn) {
  const mock = createMockDbClient(db)
  const tables: string[] = []
  const client = { from: (table: string) => (tables.push(table), mock.from(table)) }
  const response = await handleGetMovieProjections(request(body), { authenticate, client, today: TODAY })
  return { status: response.status, body: await response.json(), tables }
}

Deno.test('get-movie-projections - 401 when the caller is not signed in', async () => {
  const unauthorized: ProjectionsDeps['authenticate'] = () => Promise.resolve(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
  const { status } = await call(makeDb(), undefined, unauthorized)
  assertEquals(status, 401)
})

Deno.test('get-movie-projections - 400 on a malformed body', async (t) => {
  const cases: Array<[string, unknown]> = [
    ['not JSON', '{nope'],
    ['missing league_id', { tmdb_ids: [1] }],
    ['league_id not a UUID', { league_id: 'league-1', tmdb_ids: [1] }],
    ['tmdb_ids missing', { league_id: LEAGUE_ID }],
    ['tmdb_ids empty', { league_id: LEAGUE_ID, tmdb_ids: [] }],
    ['tmdb_ids too many', { league_id: LEAGUE_ID, tmdb_ids: Array.from({ length: MAX_TMDB_IDS + 1 }, (_, i) => i + 1) }],
    ['tmdb_ids not integers', { league_id: LEAGUE_ID, tmdb_ids: [1.5] }],
    ['tmdb_ids strings', { league_id: LEAGUE_ID, tmdb_ids: ['101'] }],
    ['tmdb_ids non-positive', { league_id: LEAGUE_ID, tmdb_ids: [0] }],
  ]
  for (const [name, body] of cases) {
    await t.step(name, async () => {
      const { status } = await call(makeDb(), body)
      assertEquals(status, 400)
    })
  }
})

Deno.test('get-movie-projections - accepts exactly 100 ids', async () => {
  const ids = Array.from({ length: MAX_TMDB_IDS }, (_, i) => i + 1)
  const { status, body } = await call(makeDb(), { league_id: LEAGUE_ID, tmdb_ids: ids })
  assertEquals(status, 200)
  assertEquals(Object.keys(body.projections).length, MAX_TMDB_IDS)
})

Deno.test('get-movie-projections - 403 for a non-member, and for an unknown league', async () => {
  assertEquals((await call(makeDb({ member: false }))).status, 403)
  const unknown = makeDb()
  unknown.leagues = []
  assertEquals((await call(unknown)).status, 403)
})

Deno.test('get-movie-projections - flag off answers enabled:false before any other read', async () => {
  // A non-member still gets enabled:false: nothing is revealed, and the
  // membership query is skipped entirely while the feature is off.
  const db = makeDb({ flag: { enabled: false }, member: false })
  const { status, body, tables } = await call(db)
  assertEquals(status, 200)
  assertEquals(body, { enabled: false })
  assertEquals(tables, ['feature_flags'])
})

Deno.test('get-movie-projections - a missing flag row is off', async () => {
  const { body } = await call(makeDb({ flag: null }))
  assertEquals(body, { enabled: false })
})

Deno.test('get-movie-projections - a series not on the allowlist answers enabled:false', async () => {
  const { status, body, tables } = await call(makeDb({ league: { series_id: OTHER_SERIES_ID } }))
  assertEquals(status, 200)
  assertEquals(body, { enabled: false })
  assertEquals(tables.includes('movie_projections'), false)
})

Deno.test('get-movie-projections - no series_ids in config means every league', async () => {
  const { body } = await call(makeDb({ flag: { config: {} }, league: { series_id: OTHER_SERIES_ID } }))
  assertEquals(body.enabled, true)
})

Deno.test('get-movie-projections - enabled returns the contract shape, null for uncached ids', async () => {
  const { status, body } = await call(makeDb(), { league_id: LEAGUE_ID, tmdb_ids: [101, 202, 101] })
  assertEquals(status, 200)
  const response = body as Extract<GetMovieProjectionsResponse, { enabled: true }>
  assertEquals(response.enabled, true)
  assertEquals(response.model_version, 3)
  assertEquals(Object.keys(response.projections).sort(), ['101', '202'])
  assertEquals(response.projections['202'], null)

  const projection = response.projections['101']
  assertExists(projection)
  assertEquals(projection, {
    tmdb_id: 101,
    projected_rt: 72.4,
    range50: [66, 79],
    range80: [55.5, 86],
    low_confidence: true,
    insufficient_history: false,
    p_rotten: 0.18,
    p_fresh: 0.82,
    p_90: 0.09,
    expected_points: 11.2,
    baseline_rt: 61,
    contributions: [
      { factor: 'director', label: 'Director', delta_rt: 8.4 },
      { factor: 'genre_month', label: 'October release', delta_rt: 3 },
    ],
    coverage: 0.6,
    partial: false,
    includes_early_reviews: false,
    early_rt: null,
    computed_at: '2026-10-01T10:00:00.000Z',
  })
})

Deno.test('get-movie-projections - no cached rows at all reports model_version 0', async () => {
  const { body } = await call(makeDb({ db: { movie_projections: [] } }))
  assertEquals(body, { enabled: true, model_version: 0, projections: { '101': null } })
})

Deno.test('get-movie-projections - released and scored movies are null; scored-before-release still projects', async () => {
  const db = makeDb({
    db: {
      movie_projections: [projectionRow(101), projectionRow(102), projectionRow(103)],
      movies: [
        { tmdb_id: 101, release_date: '2026-09-01', fantasy_points: 14 }, // released + scored
        { tmdb_id: 102, release_date: '2026-11-20', fantasy_points: 20 }, // pre-release score
        { tmdb_id: 103, release_date: '2026-09-01', fantasy_points: null }, // released, unscored
      ],
    },
  })
  const { body } = await call(db, { league_id: LEAGUE_ID, tmdb_ids: [101, 102, 103] })
  assertEquals(body.projections['101'], null)
  assertExists(body.projections['102'])
  assertExists(body.projections['103'])
})

Deno.test('get-movie-projections - a frozen row is never served', async () => {
  const db = makeDb({ db: { movie_projections: [projectionRow(101, { frozen_at: '2026-09-02T06:00:00Z', actual_rt: 88 })] } })
  const { body } = await call(db)
  assertEquals(body.projections['101'], null)
})

Deno.test('get-movie-projections - expected_points follows the league double-points rule', async () => {
  const standard = await call(makeDb({ league: { double_points_over_90: false } }))
  assertEquals(standard.body.projections['101'].expected_points, 11.2)
  const doubled = await call(makeDb({ league: { double_points_over_90: true } }))
  assertEquals(doubled.body.projections['101'].expected_points, 12.05)
  assertEquals('expected_points_double' in doubled.body.projections['101'], false)
})

Deno.test('get-movie-projections - early reviews and low coverage flags pass through', async () => {
  const db = makeDb({
    db: {
      movie_projections: [
        projectionRow(101, { includes_early_reviews: true, early_rt_score: 88, early_rt_reviews: 24, range50_lo: '70', range50_hi: '78', coverage: '0.10' }),
      ],
    },
  })
  const projection = (await call(db)).body.projections['101']
  assertEquals(projection.includes_early_reviews, true)
  assertEquals(projection.early_rt, { score: 88, reviews: 24 })
  assertEquals(projection.low_confidence, false)
  assertEquals(projection.insufficient_history, true)
})
