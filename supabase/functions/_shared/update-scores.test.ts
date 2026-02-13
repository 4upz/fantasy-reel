/**
 * Unit tests for update-scores Edge Function logic.
 *
 * Pure unit tests with mocked Deno.env, globalThis.fetch, and Supabase client.
 * No running Supabase or Edge Function runtime required.
 *
 * Run with: deno task test:unit
 */

import { assertEquals, assertExists } from '@std/assert'
import { normalizeRating } from './scoring.ts'
import { isValidUUID } from './utils.ts'

// ============================================================================
// Types matching the Edge Function
// ============================================================================

interface UpdateScoresRequest {
  movie_ids?: string[]
  league_id?: string
}

interface MovieRecord {
  id: string
  tmdb_id: number
  imdb_id: string | null
  title: string
}

interface OMDbRating {
  Source: string
  Value: string
}

interface OMDbResponse {
  Response: string
  Error?: string
  Ratings?: OMDbRating[]
}

interface UpdateScoresResult {
  movies_fetched: number
  scores_updated: number
  errors: Array<{ movie_id: string; title: string; error: string }>
}

// ============================================================================
// parseRequestBody - replicated from index.ts for unit testing
// ============================================================================

function parseRequestBody(body: string): UpdateScoresRequest {
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    return {}
  }
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
  const updateCalls: Array<{ table: string; data: unknown; id: string }> = []

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
      then: (resolve: (v: MockQueryResult) => void) => resolve(result),
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
        update: (data: unknown) => {
          return {
            eq: (_col: string, id: string) => {
              updateCalls.push({ table, data, id })
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
  OMDB_API_KEY?: string
  TMDB_API_KEY?: string
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

      // API key checks
      const omdbApiKey = env.OMDB_API_KEY
      if (!omdbApiKey) {
        return new Response(JSON.stringify({ error: 'Score update service not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const tmdbApiKey = env.TMDB_API_KEY
      if (!tmdbApiKey) {
        return new Response(JSON.stringify({ error: 'Score update service not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Parse body
      const params = req.method === 'POST'
        ? parseRequestBody(await req.text())
        : {}

      let moviesToUpdate: MovieRecord[] = []

      if (params.movie_ids && params.movie_ids.length > 0) {
        const validIds = params.movie_ids.filter(id => isValidUUID(id))
        if (validIds.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid movie_ids provided' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const query = supabaseClient.from('movies').select()
        const { data, error } = await (query as unknown as Promise<MockQueryResult>)
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

        const query = supabaseClient.from('draft_picks').select()
        const { data, error } = await (query as unknown as Promise<MockQueryResult>)
        if (error) {
          return new Response(JSON.stringify({ error: 'Failed to fetch drafted movies' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        moviesToUpdate = (data as MovieRecord[]) || []
      } else {
        const query = supabaseClient.from('movies').select()
        const { data, error } = await (query as unknown as Promise<MockQueryResult>)
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
      }

      for (const movie of moviesToUpdate) {
        let imdbId = movie.imdb_id
        if (!imdbId && movie.tmdb_id) {
          // Fetch IMDB ID from TMDb
          try {
            const tmdbRes = await fetchFn(
              `https://api.themoviedb.org/3/movie/${movie.tmdb_id}/external_ids`,
              {
                headers: {
                  Authorization: `Bearer ${tmdbApiKey}`,
                  'Content-Type': 'application/json',
                },
              },
            )
            if (tmdbRes.ok) {
              const tmdbData = await tmdbRes.json()
              imdbId = tmdbData.imdb_id || null
            }
          } catch {
            // TMDb fetch failed
          }
          if (imdbId) {
            await supabaseClient.from('movies').update({ imdb_id: imdbId }).eq('id', movie.id)
          }
        }

        if (!imdbId) {
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: 'No IMDB ID available',
          })
          continue
        }

        try {
          const omdbUrl = `https://www.omdbapi.com/?apikey=${omdbApiKey}&i=${imdbId}`
          const omdbResponse = await fetchFn(omdbUrl)

          if (!omdbResponse.ok) {
            if (omdbResponse.status === 401) {
              results.errors.push({
                movie_id: movie.id,
                title: movie.title,
                error: 'OMDb API authentication failed',
              })
              continue
            }
            results.errors.push({
              movie_id: movie.id,
              title: movie.title,
              error: `OMDb API error: ${omdbResponse.status}`,
            })
            continue
          }

          const omdbData: OMDbResponse = await omdbResponse.json()

          if (omdbData.Response === 'False') {
            results.errors.push({
              movie_id: movie.id,
              title: movie.title,
              error: omdbData.Error || 'Movie not found on OMDb',
            })
            continue
          }

          results.movies_fetched++

          let ratingsStored = 0
          if (omdbData.Ratings && omdbData.Ratings.length > 0) {
            for (const rating of omdbData.Ratings) {
              const { source, score } = normalizeRating(rating)
              if (!source || score === null) continue

              const { error: reviewError } = await supabaseClient
                .from('reviews')
                .upsert({
                  movie_id: movie.id,
                  source,
                  score,
                  raw_score: rating.Value,
                  fetched_at: new Date().toISOString(),
                }, { onConflict: 'movie_id,source' })

              if (!reviewError) {
                ratingsStored++
              }
            }
          }

          if (ratingsStored > 0) {
            const { error: calcError } = await supabaseClient.rpc(
              'calculate_movie_score',
              { p_movie_id: movie.id },
            )
            if (calcError) {
              results.errors.push({
                movie_id: movie.id,
                title: movie.title,
                error: 'Score calculation failed',
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
  OMDB_API_KEY: 'test-omdb-key',
  TMDB_API_KEY: 'test-tmdb-key',
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

function omdbSuccess(ratings: OMDbRating[] = [
  { Source: 'Internet Movie Database', Value: '8.8/10' },
  { Source: 'Rotten Tomatoes', Value: '79%' },
  { Source: 'Metacritic', Value: '66/100' },
]): OMDbResponse {
  return { Response: 'True', Ratings: ratings }
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
// Group 2: CONFIG (2 tests)
// ============================================================================

Deno.test('update-scores config validation', async (t) => {
  await t.step('returns 503 when OMDB_API_KEY not configured', async () => {
    const client = createMockSupabaseClient()
    const env = { ...DEFAULT_ENV, OMDB_API_KEY: undefined }
    const handler = buildHandler(env, client)
    const req = makeRequest('POST')

    const res = await handler(req)
    assertEquals(res.status, 503)
    const body = await res.json()
    assertEquals(body.error, 'Score update service not configured')
  })

  await t.step('returns 503 when TMDB_API_KEY not configured', async () => {
    const client = createMockSupabaseClient()
    const env = { ...DEFAULT_ENV, TMDB_API_KEY: undefined }
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

  await t.step('parseRequestBody returns {} for invalid JSON', () => {
    const result = parseRequestBody('not valid json {{{')
    assertEquals(result, {})
  })

  await t.step('parseRequestBody returns {} for empty string', () => {
    const result = parseRequestBody('')
    assertEquals(result, {})
  })
})

// ============================================================================
// Group 4: SCORING LOGIC (10 tests)
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

  await t.step('resolves IMDB ID from TMDb when movie has no imdb_id', async () => {
    const movie = testMovie({ imdb_id: null, tmdb_id: 550 })
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('themoviedb.org')) {
        return Promise.resolve(new Response(JSON.stringify({ imdb_id: 'tt0137523' }), { status: 200 }))
      }
      // OMDb response
      return Promise.resolve(new Response(JSON.stringify(omdbSuccess()), { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 1)
    assertEquals(body.errors.length, 0)
  })

  await t.step('stores resolved IMDB ID back to movies table', async () => {
    const movie = testMovie({ imdb_id: null, tmdb_id: 550 })
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('themoviedb.org')) {
        return Promise.resolve(new Response(JSON.stringify({ imdb_id: 'tt0137523' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(omdbSuccess()), { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    await handler(req)

    // Verify the update call was made to store the resolved IMDB ID
    assertEquals(client._updateCalls.length, 1)
    assertEquals(client._updateCalls[0].table, 'movies')
    assertEquals((client._updateCalls[0].data as { imdb_id: string }).imdb_id, 'tt0137523')
    assertEquals(client._updateCalls[0].id, VALID_MOVIE_ID)
  })

  await t.step('reports error when movie has no IMDB ID and TMDb lookup fails', async () => {
    const movie = testMovie({ imdb_id: null, tmdb_id: 999999 })
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('themoviedb.org')) {
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response('', { status: 500 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].movie_id, VALID_MOVIE_ID)
    assertEquals(body.errors[0].error, 'No IMDB ID available')
  })

  await t.step('reports OMDb 401 as authentication failure', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('omdbapi.com')) {
        return Promise.resolve(new Response('Unauthorized', { status: 401 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'OMDb API authentication failed')
  })

  await t.step('reports error when OMDb Response is False', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
    })

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('omdbapi.com')) {
        return Promise.resolve(
          new Response(JSON.stringify({ Response: 'False', Error: 'Movie not found!' }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'Movie not found!')
  })

  await t.step('upserts ratings and calls calculate_movie_score RPC', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
      rpc: { calculate_movie_score: { data: 32, error: null } },
    })

    const ratings = [
      { Source: 'Internet Movie Database', Value: '8.8/10' },
      { Source: 'Rotten Tomatoes', Value: '79%' },
    ]

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('omdbapi.com')) {
        return Promise.resolve(
          new Response(JSON.stringify(omdbSuccess(ratings)), { status: 200 }),
        )
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.movies_fetched, 1)
    assertEquals(body.scores_updated, 1)
    assertEquals(body.errors.length, 0)

    // Verify ratings were upserted
    assertEquals(client._upsertCalls.length, 2)

    // Verify RPC was called
    assertEquals(client._rpcCalls.length, 1)
    assertEquals(client._rpcCalls[0].fn, 'calculate_movie_score')
    assertEquals(
      (client._rpcCalls[0].params as { p_movie_id: string }).p_movie_id,
      VALID_MOVIE_ID,
    )
  })

  await t.step('increments scores_updated only when RPC succeeds', async () => {
    const movie = testMovie()
    const client = createMockSupabaseClient({
      movies: { select: { data: [movie], error: null } },
      rpc: { calculate_movie_score: { data: null, error: { message: 'RPC failed' } } },
    })

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('omdbapi.com')) {
        return Promise.resolve(new Response(JSON.stringify(omdbSuccess()), { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
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

    const fetchFn = (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('omdbapi.com')) {
        return Promise.resolve(new Response(JSON.stringify(omdbSuccess()), { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }

    const handler = buildHandler(DEFAULT_ENV, client, fetchFn as typeof globalThis.fetch)
    const req = makeRequest('POST', { movie_ids: [VALID_MOVIE_ID] })

    const res = await handler(req)
    assertEquals(res.status, 200)
    const body: UpdateScoresResult = await res.json()
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].movie_id, VALID_MOVIE_ID)
    assertEquals(body.errors[0].error, 'Score calculation failed')
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
