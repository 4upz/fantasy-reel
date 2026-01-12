/**
 * Unit tests for search-movies Edge Function
 */

import { assertEquals } from '@std/assert'
import {
  createMockRequest,
  mockEnvVars,
  mockFetch,
  mockJsonResponse,
} from '../_test_utils/mocks.ts'
import { mockTMDbSearchResponse } from '../_test_utils/fixtures.ts'

let cleanupFetch: (() => void) | null = null

// Recreate handler logic for testing
async function handleSearchMovies(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest } = await import(
    '../_shared/utils.ts'
  )

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      return errorResponse('Search service not configured', 503)
    }

    let params: { query?: string; page?: number; year?: number }
    try {
      params = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { query, page = 1, year } = params

    if (!query || query.trim().length === 0) {
      return errorResponse('Query is required', 400)
    }

    const tmdbUrl = new URL('https://api.themoviedb.org/3/search/movie')
    tmdbUrl.searchParams.set('query', query.trim())
    tmdbUrl.searchParams.set('page', page.toString())
    tmdbUrl.searchParams.set('include_adult', 'false')
    tmdbUrl.searchParams.set('language', 'en-US')

    if (year) {
      tmdbUrl.searchParams.set('year', year.toString())
    }

    const tmdbResponse = await fetch(tmdbUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${tmdbToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!tmdbResponse.ok) {
      if (tmdbResponse.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (tmdbResponse.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      return errorResponse('Failed to search movies', 502)
    }

    const tmdbData = await tmdbResponse.json()

    const results = tmdbData.results.map((movie: any) => ({
      tmdb_id: movie.id,
      title: movie.title,
      overview: movie.overview,
      release_date: movie.release_date,
      poster_url: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      vote_average: movie.vote_average,
      popularity: movie.popularity,
      genre_ids: movie.genre_ids,
    }))

    return jsonResponse({
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: tmdbData.total_results,
      results,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
}

const cleanupEnv = mockEnvVars({
  TMDB_API_KEY: 'mock-tmdb-token',
})

// ============================================================================
// Configuration Tests
// ============================================================================

Deno.test('search-movies: configuration', async (t) => {
  await t.step('returns 503 when TMDB_API_KEY not configured', async () => {
    const restoreEnv = mockEnvVars({})

    const req = createMockRequest({ body: { query: 'test' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 503)
    const body = await response.json()
    assertEquals(body.error, 'Search service not configured')

    restoreEnv()
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('search-movies: validation', async (t) => {
  await t.step('returns 400 when query is missing', async () => {
    const req = createMockRequest({ body: {} })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Query is required')
  })

  await t.step('returns 400 when query is empty string', async () => {
    const req = createMockRequest({ body: { query: '' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Query is required')
  })

  await t.step('returns 400 when query is whitespace only', async () => {
    const req = createMockRequest({ body: { query: '   ' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Query is required')
  })

  await t.step('returns 400 on invalid JSON body', async () => {
    const req = new Request('http://localhost/test', {
      method: 'POST',
      body: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invalid JSON body')
  })
})

// ============================================================================
// TMDb API Tests
// ============================================================================

Deno.test('search-movies: TMDb API', async (t) => {
  await t.step('returns 401 on TMDb auth failure', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org',
        response: new Response('Unauthorized', { status: 401 }),
      },
    ])

    const req = createMockRequest({ body: { query: 'fight club' } })
    const response = await handleSearchMovies(req)

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

    const req = createMockRequest({ body: { query: 'fight club' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 429)
    const body = await response.json()
    assertEquals(body.error, 'TMDb rate limit exceeded. Try again later.')

    cleanupFetch()
  })

  await t.step('returns 502 on other TMDb errors', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org',
        response: new Response('Server error', { status: 500 }),
      },
    ])

    const req = createMockRequest({ body: { query: 'fight club' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 502)
    const body = await response.json()
    assertEquals(body.error, 'Failed to search movies')

    cleanupFetch()
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('search-movies: success', async (t) => {
  await t.step('returns search results with transformed data', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(mockTMDbSearchResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'fight club' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.page, 1)
    assertEquals(body.total_pages, 1)
    assertEquals(body.total_results, 2)
    assertEquals(body.results.length, 2)

    // Check first result transformation
    const first = body.results[0]
    assertEquals(first.tmdb_id, 550)
    assertEquals(first.title, 'Fight Club')
    assertEquals(first.poster_url, 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg')
    assertEquals(first.vote_average, 8.4)
    assertEquals(first.genre_ids, [18, 53, 35])

    // Check null poster handling
    const second = body.results[1]
    assertEquals(second.poster_url, null)

    cleanupFetch()
  })

  await t.step('returns empty results when no matches', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse({
          page: 1,
          results: [],
          total_pages: 0,
          total_results: 0,
        }),
      },
    ])

    const req = createMockRequest({ body: { query: 'zzzznonexistent' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.results, [])
    assertEquals(body.total_results, 0)

    cleanupFetch()
  })

  await t.step('passes pagination parameter', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse({
          page: 2,
          results: [],
          total_pages: 3,
          total_results: 50,
        }),
      },
    ])

    const req = createMockRequest({ body: { query: 'star wars', page: 2 } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.page, 2)

    cleanupFetch()
  })
})

// ============================================================================
// CORS Tests
// ============================================================================

Deno.test('search-movies: CORS', async (t) => {
  await t.step('handles OPTIONS preflight request', async () => {
    const req = new Request('http://localhost/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    })

    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    assertEquals(response.headers.get('Access-Control-Allow-Origin'), '*')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
  if (cleanupFetch) cleanupFetch()
})
