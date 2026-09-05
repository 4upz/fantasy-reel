/**
 * Unit tests for update-scores Edge Function logic.
 *
 * Pure unit tests with mocked Deno.env, globalThis.fetch, and Supabase client.
 * No running Supabase or Edge Function runtime required.
 *
 * Run with: deno task test:unit
 */

import { assertEquals, assertExists } from '@std/assert'
import { fetchMDBListRatings, MDBLIST_NOT_FOUND } from './scoring.ts'
import type { MovieRecord, MDBListRating, MDBListResponse } from './scoring.ts'
import { isValidUUID } from './utils.ts'

// ============================================================================
// Types specific to this test file
// ============================================================================

interface UpdateScoresRequest {
  movie_ids?: string[]
  league_id?: string
}

interface UpdateScoresResult {
  movies_fetched: number
  scores_updated: number
  errors: Array<{ movie_id: string; title: string; error: string }>
  unscored: Array<{ movie_id: string; title: string; reason: string }>
}

// ============================================================================
// Mock Supabase client builder
// ============================================================================

interface MockQueryResult {
  data: unknown
  error: { message: string } | null
}

interface MockSupabaseConfig {
  movies?: {
    select?: MockQueryResult
    update?: MockQueryResult
  }
  draft_picks?: {
    select?: MockQueryResult
  }
  reviews?: {
    upsert?: MockQueryResult
  }
  rpc?: {
    calculate_movie_score?: MockQueryResult
  }
}

function createMockSupabaseClient(config: MockSupabaseConfig = {}) {
  const upsertCalls: unknown[] = []
  const rpcCalls: Array<{ fn: string; params: unknown }> = []
  const updateCalls: Array<{ table: string; values: unknown; id: string }> = []

  function chainable(result: MockQueryResult) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      lte: () => chain,
      or: () => chain,
      limit: () => chain,
      single: () => Promise.resolve(result),
    }
    return chain
  }

  return {
    _upsertCalls: upsertCalls,
    _rpcCalls: rpcCalls,
    _updateCalls: updateCalls,
    from(table: string) {
      const tableConfig = config[table as keyof MockSupabaseConfig]
      return {
        select: () => {
          const result = (tableConfig as { select?: MockQueryResult })?.select ??
            { data: [], error: null }
          return chainable(result)
        },
        update: (values: unknown) => {
          return {
            eq: (_col: string, id: string) => {
              updateCalls.push({ table, values, id })
              const result = (tableConfig as { update?: MockQueryResult })?.update ??
                { data: null, error: null }
              return Promise.resolve(result)
            },
          }
        },
        upsert: (data: unknown, _opts?: unknown) => {
          upsertCalls.push(data)
          const result = (config.reviews as { upsert?: MockQueryResult })?.upsert ??
            { data: null, error: null }
          return Promise.resolve(result)
        },
      }
    },
    rpc(fn: string, params: unknown) {
      rpcCalls.push({ fn, params })
      const result = config.rpc?.[fn as keyof typeof config.rpc] ??
        { data: null, error: null }
      return Promise.resolve(result)
    },
  }
}

// ============================================================================
// Handler builder - mirrors update-scores/index.ts logic with injected deps
// ============================================================================

interface HandlerEnv {
  CRON_SECRET?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  MDBLIST_API_KEY?: string
  SUPABASE_URL?: string
}

function buildHandler(
  env: HandlerEnv,
  supabaseClient: ReturnType<typeof createMockSupabaseClient>,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
) {
  return async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      })
    }

    try {
      // Auth check
      const cronSecret = env.CRON_SECRET
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

      const isAuthorizedByCron = cronSecret && req.headers.get('X-Cron-Secret') === cronSecret
      const isAuthorizedByServiceRole =
        serviceRoleKey && req.headers.get('Authorization') === `Bearer ${serviceRoleKey}`

      if (!isAuthorizedByCron && !isAuthorizedByServiceRole) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // API key check
      const mdblistApiKey = env.MDBLIST_API_KEY
      if (!mdblistApiKey) {
        return new Response(JSON.stringify({ error: 'Score update service not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Parse body (inline — matches index.ts parseRequestBody)
      let params: UpdateScoresRequest = {}
      if (req.method === 'POST') {
        try {
          const text = await req.text()
          params = text ? JSON.parse(text) : {}
        } catch {
          params = {}
        }
      }

      let moviesToUpdate: MovieRecord[] = []

      if (params.movie_ids && params.movie_ids.length > 0) {
        const validIds = params.movie_ids.filter(id => isValidUUID(id))
        if (validIds.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid movie_ids provided' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const { data, error } = await supabaseClient.from('movies').select().single()
        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to fetch movies' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        moviesToUpdate = (data as MovieRecord[]) || []
      } else if (params.league_id) {
        if (!isValidUUID(params.league_id)) {
          return new Response(JSON.stringify({ error: 'Invalid league_id' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const { data, error } = await supabaseClient.from('draft_picks').select().single()
        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to fetch drafted movies' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        moviesToUpdate = (data as MovieRecord[]) || []
      } else {
        const { data, error } = await supabaseClient.from('movies').select().single()
        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to fetch movies' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        moviesToUpdate = (data as MovieRecord[]) || []
      }

      if (moviesToUpdate.length === 0) {
        return new Response(
          JSON.stringify({ movies_fetched: 0, scores_updated: 0, errors: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const results: UpdateScoresResult = {
        movies_fetched: 0,
        scores_updated: 0,
        errors: [],
        unscored: [],
      }

      // Mirrors index.ts markScoreChecked: stamp a movie as checked so it
      // rotates to the back of the stalest-first queue instead of re-qualifying
      // (and hogging a batch slot) on every run.
      async function markScoreChecked(movieId: string): Promise<void> {
        await supabaseClient
          .from('movies')
          .update({ scores_updated_at: new Date().toISOString() })
          .eq('id', movieId)
      }

      for (const movie of moviesToUpdate) {
        if (!movie.tmdb_id) {
          await markScoreChecked(movie.id)
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: 'No TMDb ID available',
          })
          continue
        }

        try {
          // fetchMDBListRatings uses globalThis.fetch internally and doesn't accept
          // an injected fetch, so we temporarily replace it for test mocking.
          const originalGlobalFetch = globalThis.fetch
          globalThis.fetch = fetchFn
          let fetchResult: { ratings: Array<{ source: string | null; score: number | null; raw: string }>; error?: string }
          try {
            fetchResult = await fetchMDBListRatings(movie.tmdb_id, mdblistApiKey)
          } finally {
            globalThis.fetch = originalGlobalFetch
          }

          if (fetchResult.error) {
            if (fetchResult.error === MDBLIST_NOT_FOUND) {
              await markScoreChecked(movie.id)
              results.unscored.push({
                movie_id: movie.id,
                title: movie.title,
                reason: 'not_on_mdblist',
              })
            } else {
              results.errors.push({
                movie_id: movie.id,
                title: movie.title,
                error: fetchResult.error,
              })
            }
            continue
          }

          if (fetchResult.ratings.length === 0) {
            await markScoreChecked(movie.id)
            results.unscored.push({
              movie_id: movie.id,
              title: movie.title,
              reason: 'no_ratings',
            })
            continue
          }

          results.movies_fetched++

          const now = new Date().toISOString()
          const reviewRows = fetchResult.ratings
            .filter((r: { source: string | null; score: number | null }) => r.source && r.score !== null)
            .map((r: { source: string | null; score: number | null; raw: string }) => ({
              movie_id: movie.id,
              source: r.source,
              score: r.score,
              raw_score: r.raw,
              fetched_at: now,
            }))

          let ratingsStored = 0
          if (reviewRows.length > 0) {
            const { error: reviewError } = await supabaseClient
              .from('reviews')
              .upsert(reviewRows, { onConflict: 'movie_id,source' })

            if (!reviewError) {
              ratingsStored = reviewRows.length
            }
          }

          if (ratingsStored > 0) {
            const { data: fantasyPts, error: calcError } = await supabaseClient.rpc(
              'calculate_movie_score',
              { p_movie_id: movie.id },
            )
            if (calcError) {
              results.errors.push({
                movie_id: movie.id,
                title: movie.title,
                error: 'Score calculation failed',
              })
            } else if (fantasyPts === null) {
              // Ratings stored but no Tomatometer among them (mirrors index.ts)
              results.unscored.push({
                movie_id: movie.id,
                title: movie.title,
                reason: 'no_rt_score',
              })
            } else {
              results.scores_updated++
            }
          }
        } catch {
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: 'Failed to fetch or process ratings',
          })
        }
      }

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}

// ============================================================================
// Test helpers
// ============================================================================

const VALID_MOVIE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const VALID_MOVIE_ID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
const VALID_LEAGUE_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012'

const DEFAULT_ENV: HandlerEnv = {
  CRON_SECRET: 'test-cron-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  MDBLIST_API_KEY: 'test-mdblist-key',
  SUPABASE_URL: 'http://127.0.0.1:54321',
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${DEFAULT_ENV.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

function cronHeaders(): Record<string, string> {
  return {
    'X-Cron-Secret': DEFAULT_ENV.CRON_SECRET!,
    'Content-Type': 'application/json',
  }
}

function makeRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request('http://localhost/functions/v1/update-scores', {
    method,
    headers: headers ?? authHeaders(),
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
}

function testMovie(overrides: Partial<MovieRecord> = {}): MovieRecord {
  return {
    id: VALID_MOVIE_ID,
    tmdb_id: 550,
    imdb_id: 'tt0137523',
    title: 'Fight Club',
    ...overrides,
  }
}

function mdblistSuccess(ratings: MDBListRating[] = [
  { source: 'imdb', value: 8.8, score: 88, votes: 2000000 },
  { source: 'tomatoes', value: 79, score: 79, votes: 300 },
  { source: 'metacritic', value: 66, score: 66, votes: 50 },
]): MDBListResponse {
  return { title: 'Fight Club', ratings }
}

/** Create a fetch mock that returns the given MDBList response for MDBList URLs. */
function mockMDBListFetch(response: MDBListResponse, status = 200): typeof globalThis.fetch {
  return ((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    if (urlStr.includes('api.mdblist.com')) {
      return Promise.resolve(new Response(JSON.stringify(response), { status }))
    }
    return Promise.resolve(new Response('', { status: 200 }))
  }) as typeof globalThis.fetch
}

/** Create a fetch mock that returns an error status for MDBList URLs. */
function mockMDBListErrorFetch(status: number, body = ''): typeof globalThis.fetch {
  return ((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    if (urlStr.includes('api.mdblist.com')) {
      return Promise.resolve(new Response(body, { status }))
    }
    return Promise.resolve(new Response('', { status: 200 }))
  }) as typeof globalThis.fetch
}

/**
 * Run the handler over a single movie in movie_ids mode.
 * Returns the mock client (for inspecting recorded calls) and the response.
 */
async function runSingleMovie(
  options: {
    fetchFn?: typeof globalThis.fetch
    movie?: MovieRecord
    rpc?: MockSupabaseConfig['rpc']
  } = {},
): Promise<{ client: ReturnType<typeof createMockSupabaseClient>; res: Response }> {
  const client = createMockSupabaseClient({
    movies: { select: { data: [options.movie ?? testMovie()], error: null } },
    rpc: options.rpc,
  })
  const handler = buildHandler(DEFAULT_ENV, client, options.fetchFn)
  const res = await handler(makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] }))
  return { client, res }
}

// ============================================================================
// Group 1: AUTH (4 tests)
// ============================================================================

Deno.test('update-scores auth', async (t) => {
  await t.step('returns 403 when no auth headers provided', async () => {
    const client = createMockSupabaseClient()
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = new Request('http://localhost/functions/v1/update-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await handler(req)
    assertEquals(res.status, 403)
    const body = await res.json()
    assertEquals(body.error, 'Forbidden')
  })

  await t.step('returns 403 with wrong X-Cron-Secret', async () => {
    const client = createMockSupabaseClient()
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', undefined, {
      'X-Cron-Secret': 'wrong-secret',
      'Content-Type': 'application/json',
    })

    const res = await handler(req)
    assertEquals(res.status, 403)
    const body = await res.json()
    assertEquals(body.error, 'Forbidden')
  })

  await t.step('succeeds with valid X-Cron-Secret', async () => {
    const client = createMockSupabaseClient({
      movies: { select: { data: [], error: null } },
    })
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', undefined, cronHeaders())

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.movies_fetched, 0)
  })

  await t.step('succeeds with valid Bearer service_role token', async () => {
    const client = createMockSupabaseClient({
      movies: { select: { data: [], error: null } },
    })
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', undefined, authHeaders())

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.movies_fetched, 0)
  })
})

// ============================================================================
// Group 2: CONFIG (1 test — only MDBLIST_API_KEY now)
// ============================================================================

Deno.test('update-scores config validation', async (t) => {
  await t.step('returns 503 when MDBLIST_API_KEY not configured', async () => {
    const client = createMockSupabaseClient()
    const env = { ...DEFAULT_ENV, MDBLIST_API_KEY: undefined }
    const handler = buildHandler(env, client)
    const req = makeRequest('POST')

    const res = await handler(req)
    assertEquals(res.status, 503)
    const body = await res.json()
    assertEquals(body.error, 'Score update service not configured')
  })
})

// ============================================================================
// Group 3: INPUT VALIDATION (4 tests)
// ============================================================================

Deno.test('update-scores input validation', async (t) => {
  await t.step('returns 400 for movie_ids with all invalid UUIDs', async () => {
    const client = createMockSupabaseClient()
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', { movie_ids: ['not-a-uuid', 'also-bad'] })

    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error, 'No valid movie_ids provided')
  })

  await t.step('returns 400 for invalid league_id', async () => {
    const client = createMockSupabaseClient()
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', { league_id: 'not-a-valid-uuid' })

    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error, 'Invalid league_id')
  })

  await t.step('handles invalid JSON body gracefully (falls through to default path)', async () => {
    const client = createMockSupabaseClient({
      movies: { select: { data: [], error: null } },
    })
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', 'not valid json {{{')

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 0)
  })

  await t.step('handles empty body gracefully (falls through to default path)', async () => {
    const client = createMockSupabaseClient({
      movies: { select: { data: [], error: null } },
    })
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', '')

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 0)
  })

  await t.step('handles empty movie_ids array as default mode (not a 400)', async () => {
    const client = createMockSupabaseClient({
      movies: { select: { data: [], error: null } },
    })
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', { movie_ids: [] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 0)
  })
})

// ============================================================================
// Group 4: SCORING LOGIC (11 tests)
// ============================================================================

Deno.test('update-scores scoring logic', async (t) => {
  await t.step('returns empty result when no movies match', async () => {
    const client = createMockSupabaseClient({
      movies: { select: { data: [], error: null } },
    })
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 0)
    assertEquals(body.scores_updated, 0)
    assertEquals(body.errors.length, 0)
  })

  await t.step('reports error when movie has no tmdb_id', async () => {
    const movie = testMovie({ tmdb_id: 0 })
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const handler = buildHandler(DEFAULT_ENV, client)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'No TMDb ID available')
  })

  await t.step('fetches ratings from MDBList and upserts to reviews', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
      rpc: { calculate_movie_score: { data: 32, error: null } },
    })

    const handler = buildHandler(DEFAULT_ENV, client, mockMDBListFetch(mdblistSuccess()))
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 1)
    assertEquals(body.scores_updated, 1)
    assertEquals(body.errors.length, 0)

    // Verify 1 batched upsert with 3 ratings
    assertEquals(client._upsertCalls.length, 1)
    assertEquals((client._upsertCalls[0] as unknown[]).length, 3)

    // Verify RPC was called
    assertEquals(client._rpcCalls.length, 1)
    assertEquals(client._rpcCalls[0].fn, 'calculate_movie_score')
    assertEquals(
      (client._rpcCalls[0].params as { p_movie_id: string }).p_movie_id,
      VALID_MOVIE_ID,
    )
  })

  await t.step('maps MDBList source names correctly in upsert calls', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
      rpc: { calculate_movie_score: { data: 25, error: null } },
    })

    const handler = buildHandler(DEFAULT_ENV, client, mockMDBListFetch(mdblistSuccess()))
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })
    await handler(req)

    // Verify source names in batched upsert
    const batch = client._upsertCalls[0] as Array<{ source: string }>
    const sources = batch.map((r) => r.source)
    assertEquals(sources.includes('imdb'), true)
    assertEquals(sources.includes('rotten_tomatoes'), true)
    assertEquals(sources.includes('metacritic'), true)
  })

  await t.step('reports MDBList API error for specific movie', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const handler = buildHandler(DEFAULT_ENV, client, mockMDBListErrorFetch(401, 'Unauthorized'))
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'MDBList API authentication failed')
  })

  await t.step('classifies empty MDBList ratings as unscored, not an error', async () => {
    const { res } = await runSingleMovie({
      fetchFn: mockMDBListFetch({ title: 'Test', ratings: [] }),
    })

    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 0, 'pending movies must not count as failures')
    assertEquals(body.unscored.length, 1)
    assertEquals(body.unscored[0].reason, 'no_ratings')
  })

  await t.step('classifies missing Tomatometer as unscored, not a score update', async () => {
    const { res } = await runSingleMovie({
      fetchFn: mockMDBListFetch(mdblistSuccess([{ source: 'imdb', value: 6.5, score: 65, votes: 1200 }])),
      rpc: { calculate_movie_score: { data: null, error: null } },
    })

    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 1)
    assertEquals(body.scores_updated, 0)
    assertEquals(body.errors.length, 0)
    assertEquals(body.unscored.length, 1)
    assertEquals(body.unscored[0].reason, 'no_rt_score')
  })

  await t.step('stamps scores_updated_at when MDBList has no ratings', async () => {
    const { client } = await runSingleMovie({
      fetchFn: mockMDBListFetch({ title: 'Test', ratings: [] }),
    })

    assertEquals(client._updateCalls.length, 1)
    assertEquals(client._updateCalls[0].table, 'movies')
    assertEquals(client._updateCalls[0].id, VALID_MOVIE_ID)
    assertExists((client._updateCalls[0].values as { scores_updated_at?: string }).scores_updated_at)
  })

  await t.step('stamps scores_updated_at and classifies 404 as unscored', async () => {
    const { client, res } = await runSingleMovie({ fetchFn: mockMDBListErrorFetch(404) })

    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 0, 'a movie MDBList lacks must not count as a failure')
    assertEquals(body.unscored.length, 1)
    assertEquals(body.unscored[0].reason, 'not_on_mdblist')
    assertEquals(client._updateCalls.length, 1)
    assertEquals(client._updateCalls[0].id, VALID_MOVIE_ID)
  })

  await t.step('stamps scores_updated_at for movie without TMDb ID', async () => {
    const { client } = await runSingleMovie({ movie: testMovie({ tmdb_id: 0 }) })

    assertEquals(client._updateCalls.length, 1)
    assertEquals(client._updateCalls[0].id, VALID_MOVIE_ID)
  })

  await t.step('does NOT stamp scores_updated_at on transient MDBList errors', async () => {
    // Both failures should retry on the next run, so neither may stamp.
    const transientCases: Array<{ label: string; fetchFn: typeof globalThis.fetch }> = [
      { label: 'rate limit (429)', fetchFn: mockMDBListErrorFetch(429) },
      {
        label: 'network failure',
        fetchFn: (() => Promise.reject(new Error('Network failure'))) as typeof globalThis.fetch,
      },
    ]

    for (const { label, fetchFn } of transientCases) {
      const { client } = await runSingleMovie({ fetchFn })
      assertEquals(client._updateCalls.length, 0, `${label} must not stamp scores_updated_at`)
    }
  })

  await t.step('increments scores_updated only when RPC succeeds', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
      rpc: { calculate_movie_score: { data: null, error: { message: 'RPC failed' } } },
    })

    const handler = buildHandler(DEFAULT_ENV, client, mockMDBListFetch(mdblistSuccess()))
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 1)
    assertEquals(body.scores_updated, 0)
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'Score calculation failed')
  })

  await t.step('reports RPC error with "Score calculation failed" message', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
      rpc: { calculate_movie_score: { data: null, error: { message: 'function not found' } } },
    })

    const handler = buildHandler(DEFAULT_ENV, client, mockMDBListFetch(mdblistSuccess()))
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].movie_id, VALID_MOVIE_ID)
    assertEquals(body.errors[0].error, 'Score calculation failed')
  })

  await t.step('fetches and scores movies via league_id path', async () => {
    const movie1 = testMovie()
    const movie2 = testMovie({ id: VALID_MOVIE_ID_2, tmdb_id: 680, imdb_id: 'tt0110912', title: 'Pulp Fiction' })
    const client = createMockSupabaseClient({
      draft_picks: { select: { data: [movie1, movie2], error: null } },
      rpc: { calculate_movie_score: { data: 25, error: null } },
    })

    const handler = buildHandler(DEFAULT_ENV, client, mockMDBListFetch(mdblistSuccess()))
    const req = makeRequest('POST', { league_id: VALID_LEAGUE_ID })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 2)
    assertEquals(body.scores_updated, 2)
    assertEquals(body.errors.length, 0)
  })

  await t.step('handles fetch exception gracefully', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const fetchFn = (() => Promise.reject(new Error('Network failure'))) as typeof globalThis.fetch
    const handler = buildHandler(DEFAULT_ENV, client, fetchFn)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'Failed to fetch ratings from MDBList')
  })

  await t.step('returns CORS headers for OPTIONS preflight', async () => {
    const client = createMockSupabaseClient()
    const handler = buildHandler(DEFAULT_ENV, client)
    const req = new Request('http://localhost/functions/v1/update-scores', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    })

    const res = await handler(req)
    assertEquals(res.status, 200)
    assertExists(res.headers.get('Access-Control-Allow-Origin'))
    assertExists(res.headers.get('Access-Control-Allow-Headers'))
    assertExists(res.headers.get('Access-Control-Allow-Methods'))
  })
})
