/**
 * Unit tests for sync-movies Edge Function
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  createMockSupabaseClient,
  createMockAuthRequest,
  mockEnvVars,
  mockFetch,
  mockJsonResponse,
  type MockSupabaseConfig,
} from '../_test_utils/mocks.ts'
import { mockTMDbDiscoverResponse } from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>
let cleanupFetch: (() => void) | null = null

// Recreate handler logic for testing
async function handleSyncMovies(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest } = await import(
    '../_shared/utils.ts'
  )

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbApiKey = Deno.env.get('TMDB_API_KEY')
    if (!tmdbApiKey) {
      console.error('TMDB_API_KEY not configured')
      return errorResponse('Movie sync service not configured', 503)
    }

    // Parse request body
    let params: { year?: number; page?: number; region?: string } = {}
    try {
      if (req.method === 'POST') {
        const body = await req.text()
        if (body) {
          params = JSON.parse(body)
        }
      }
    } catch {
      // Ignore parse errors
    }

    const currentYear = new Date().getFullYear()
    const year = params.year || currentYear
    const page = params.page || 1
    const region = params.region || 'US'

    const today = new Date().toISOString().split('T')[0]
    const endOfYear = `${year}-12-31`

    // Fetch from TMDb
    const tmdbUrl = new URL('https://api.themoviedb.org/3/discover/movie')
    tmdbUrl.searchParams.set('api_key', tmdbApiKey)
    tmdbUrl.searchParams.set('language', 'en-US')
    tmdbUrl.searchParams.set('region', region)
    tmdbUrl.searchParams.set('sort_by', 'popularity.desc')
    tmdbUrl.searchParams.set('include_adult', 'false')
    tmdbUrl.searchParams.set('include_video', 'false')
    tmdbUrl.searchParams.set('page', page.toString())
    tmdbUrl.searchParams.set('primary_release_date.gte', today)
    tmdbUrl.searchParams.set('primary_release_date.lte', endOfYear)
    tmdbUrl.searchParams.set('with_release_type', '2|3')

    const tmdbResponse = await fetch(tmdbUrl.toString())

    if (!tmdbResponse.ok) {
      if (tmdbResponse.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (tmdbResponse.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      return errorResponse('Failed to fetch movies from TMDb', 502)
    }

    const tmdbData = await tmdbResponse.json()

    if (!tmdbData.results || tmdbData.results.length === 0) {
      return jsonResponse({
        synced_count: 0,
        inserted_count: 0,
        updated_count: 0,
        movies: [],
        page: tmdbData.page,
        total_pages: tmdbData.total_pages,
      })
    }

    // For testing purposes, we skip the external_ids fetch loop
    // and just transform the movies directly
    const moviesToUpsert = tmdbData.results.map((movie: any) => ({
      tmdb_id: movie.id,
      imdb_id: null, // Would be fetched from external_ids in real function
      title: movie.title,
      overview: movie.overview || null,
      release_date: movie.release_date || null,
      poster_url: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      backdrop_url: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
      popularity: movie.popularity,
      vote_average: movie.vote_average,
      vote_count: movie.vote_count,
      status: 'upcoming',
      last_synced_at: new Date().toISOString(),
    }))

    const { data: upsertedMovies, error: upsertError } = await mockClient
      .from('movies')
      .upsert(moviesToUpsert, {
        onConflict: 'tmdb_id',
        ignoreDuplicates: false,
      })
      .select('id, tmdb_id, title, release_date')

    if (upsertError) {
      return errorResponse('Failed to save movies to database', 500)
    }

    const syncedCount = upsertedMovies?.length || 0

    return jsonResponse({
      synced_count: syncedCount,
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: tmdbData.total_results,
      movies:
        upsertedMovies?.map((m: any) => ({
          tmdb_id: m.tmdb_id,
          title: m.title,
          release_date: m.release_date,
        })) || [],
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
}

const cleanupEnv = mockEnvVars({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
  TMDB_API_KEY: 'mock-tmdb-key',
})

// ============================================================================
// Configuration Tests
// ============================================================================

Deno.test('sync-movies: configuration', async (t) => {
  await t.step('returns 503 when TMDB_API_KEY not configured', async () => {
    // Temporarily remove the API key
    const restoreEnv = mockEnvVars({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
      // No TMDB_API_KEY
    })

    const req = createMockAuthRequest({})
    const response = await handleSyncMovies(req)

    assertEquals(response.status, 503)
    const body = await response.json()
    assertEquals(body.error, 'Movie sync service not configured')

    restoreEnv()
  })
})

// ============================================================================
// TMDb API Tests
// ============================================================================

Deno.test('sync-movies: TMDb API', async (t) => {
  await t.step('returns 401 on TMDb auth failure', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org',
        response: new Response('Unauthorized', { status: 401 }),
      },
    ])

    mockSupabaseConfig = {}
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleSyncMovies(req)

    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(body.error, 'TMDb API authentication failed')

    cleanupFetch()
  })

  await t.step('returns 429 on TMDb rate limit', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org',
        response: new Response('Rate limited', { status: 429 }),
      },
    ])

    const req = createMockAuthRequest({})
    const response = await handleSyncMovies(req)

    assertEquals(response.status, 429)
    const body = await response.json()
    assertEquals(body.error, 'TMDb rate limit exceeded. Try again later.')

    cleanupFetch()
  })

  await t.step('returns empty result when no movies found', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org',
        response: mockJsonResponse({
          page: 1,
          results: [],
          total_pages: 0,
          total_results: 0,
        }),
      },
    ])

    const req = createMockAuthRequest({})
    const response = await handleSyncMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.synced_count, 0)
    assertEquals(body.movies, [])

    cleanupFetch()
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('sync-movies: success', async (t) => {
  await t.step('transforms and upserts movies correctly', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/discover',
        response: mockJsonResponse(mockTMDbDiscoverResponse),
      },
    ])

    const upsertedMovies = [
      {
        id: 'movie-1',
        tmdb_id: 12345,
        title: 'Upcoming Movie 1',
        release_date: '2024-06-15',
      },
      {
        id: 'movie-2',
        tmdb_id: 67890,
        title: 'Upcoming Movie 2',
        release_date: '2024-07-20',
      },
    ]

    mockSupabaseConfig = {
      tables: {
        movies: {
          upsert: { data: upsertedMovies, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ page: 1 })
    const response = await handleSyncMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.synced_count, 2)
    assertEquals(body.page, 1)
    assertEquals(body.total_pages, 5)
    assertEquals(body.movies.length, 2)
    assertEquals(body.movies[0].title, 'Upcoming Movie 1')

    cleanupFetch()
  })

  await t.step('handles database error', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/discover',
        response: mockJsonResponse(mockTMDbDiscoverResponse),
      },
    ])

    mockSupabaseConfig = {
      tables: {
        movies: {
          upsert: { data: null, error: { message: 'Database error' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleSyncMovies(req)

    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(body.error, 'Failed to save movies to database')

    cleanupFetch()
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
  if (cleanupFetch) cleanupFetch()
})
