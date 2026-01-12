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

// Helper to get date strings for testing
function getDateString(daysFromNow: number): string {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  return date.toISOString().split('T')[0]
}

// Get dates for test scenarios
const today = getDateString(0)
const tomorrow = getDateString(1)
const nextMonth = getDateString(30)
const yesterday = getDateString(-1)
const lastMonth = getDateString(-30)
const lastYear = `${new Date().getFullYear() - 1}-06-15`
const nextYear = `${new Date().getFullYear() + 1}-06-15`

interface SearchResult {
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

/**
 * Filters search results to only include upcoming movies from the current year or later.
 */
function filterUpcomingCurrentYear(results: SearchResult[]): SearchResult[] {
  const now = new Date()
  const currentYear = now.getFullYear()
  const todayStr = now.toISOString().split('T')[0]

  return results.filter((movie) => {
    if (!movie.release_date) return false

    const releaseYear = parseInt(movie.release_date.split('-')[0], 10)
    if (isNaN(releaseYear) || releaseYear < currentYear) return false

    return movie.release_date >= todayStr
  })
}

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

    const mappedResults: SearchResult[] = tmdbData.results.map((movie: any) => ({
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

    // Filter to only include upcoming movies from current year or later
    const results = filterUpcomingCurrentYear(mappedResults)

    return jsonResponse({
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: results.length,
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
    // Create response with upcoming movie only
    const upcomingMovieResponse = {
      page: 1,
      results: [
        {
          id: 551,
          title: 'Upcoming Movie',
          overview: 'A movie releasing next month.',
          release_date: nextMonth,
          poster_path: '/upcoming.jpg',
          vote_average: 8.0,
          vote_count: 100,
          popularity: 50.0,
          genre_ids: [28, 12],
        },
      ],
      total_pages: 1,
      total_results: 1,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(upcomingMovieResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'upcoming' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.page, 1)
    assertEquals(body.total_results, 1)
    assertEquals(body.results.length, 1)

    // Check result transformation
    const first = body.results[0]
    assertEquals(first.tmdb_id, 551)
    assertEquals(first.title, 'Upcoming Movie')
    assertEquals(first.poster_url, 'https://image.tmdb.org/t/p/w500/upcoming.jpg')
    assertEquals(first.vote_average, 8.0)
    assertEquals(first.release_date, nextMonth)

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
          total_results: 0,
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
// Year/Date Filtering Tests
// ============================================================================

Deno.test('search-movies: year filtering', async (t) => {
  await t.step('filters out movies from previous years', async () => {
    const mixedYearResponse = {
      page: 1,
      results: [
        {
          id: 550,
          title: 'Old Classic',
          overview: 'A movie from the past.',
          release_date: lastYear,
          poster_path: '/old.jpg',
          vote_average: 9.0,
          vote_count: 50000,
          popularity: 100.0,
          genre_ids: [18],
        },
        {
          id: 551,
          title: 'Upcoming Movie',
          overview: 'A movie releasing soon.',
          release_date: nextMonth,
          poster_path: '/upcoming.jpg',
          vote_average: 0,
          vote_count: 0,
          popularity: 50.0,
          genre_ids: [28],
        },
      ],
      total_pages: 1,
      total_results: 2,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(mixedYearResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'movie' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    // Only the upcoming movie should be returned
    assertEquals(body.total_results, 1)
    assertEquals(body.results.length, 1)
    assertEquals(body.results[0].title, 'Upcoming Movie')

    cleanupFetch()
  })

  await t.step('filters out already-released movies from current year', async () => {
    const currentYearResponse = {
      page: 1,
      results: [
        {
          id: 552,
          title: 'Released This Year',
          overview: 'Already released.',
          release_date: lastMonth,
          poster_path: '/released.jpg',
          vote_average: 7.5,
          vote_count: 1000,
          popularity: 80.0,
          genre_ids: [35],
        },
        {
          id: 553,
          title: 'Coming Next Month',
          overview: 'Not yet released.',
          release_date: nextMonth,
          poster_path: '/coming.jpg',
          vote_average: 0,
          vote_count: 0,
          popularity: 60.0,
          genre_ids: [12],
        },
      ],
      total_pages: 1,
      total_results: 2,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(currentYearResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'movie' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    // Only the upcoming movie should be returned
    assertEquals(body.total_results, 1)
    assertEquals(body.results[0].title, 'Coming Next Month')

    cleanupFetch()
  })

  await t.step('includes movies releasing today', async () => {
    const todayReleaseResponse = {
      page: 1,
      results: [
        {
          id: 554,
          title: 'Releasing Today',
          overview: 'Out today!',
          release_date: today,
          poster_path: '/today.jpg',
          vote_average: 0,
          vote_count: 0,
          popularity: 90.0,
          genre_ids: [28],
        },
      ],
      total_pages: 1,
      total_results: 1,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(todayReleaseResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'today' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.total_results, 1)
    assertEquals(body.results[0].title, 'Releasing Today')

    cleanupFetch()
  })

  await t.step('includes movies from next year', async () => {
    const nextYearResponse = {
      page: 1,
      results: [
        {
          id: 555,
          title: 'Next Year Release',
          overview: 'Coming next year.',
          release_date: nextYear,
          poster_path: '/nextyear.jpg',
          vote_average: 0,
          vote_count: 0,
          popularity: 70.0,
          genre_ids: [14],
        },
      ],
      total_pages: 1,
      total_results: 1,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(nextYearResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'next year' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.total_results, 1)
    assertEquals(body.results[0].title, 'Next Year Release')

    cleanupFetch()
  })

  await t.step('excludes movies with null release_date', async () => {
    const nullDateResponse = {
      page: 1,
      results: [
        {
          id: 556,
          title: 'No Release Date',
          overview: 'Unknown release.',
          release_date: null,
          poster_path: '/unknown.jpg',
          vote_average: 0,
          vote_count: 0,
          popularity: 40.0,
          genre_ids: [27],
        },
        {
          id: 557,
          title: 'Has Release Date',
          overview: 'Known release.',
          release_date: nextMonth,
          poster_path: '/known.jpg',
          vote_average: 0,
          vote_count: 0,
          popularity: 50.0,
          genre_ids: [28],
        },
      ],
      total_pages: 1,
      total_results: 2,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(nullDateResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'movie' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.total_results, 1)
    assertEquals(body.results[0].title, 'Has Release Date')

    cleanupFetch()
  })

  await t.step('returns empty when all results are filtered out', async () => {
    const allOldResponse = {
      page: 1,
      results: [
        {
          id: 550,
          title: 'Fight Club',
          overview: 'Classic movie.',
          release_date: '1999-10-15',
          poster_path: '/fightclub.jpg',
          vote_average: 8.4,
          vote_count: 25000,
          popularity: 45.5,
          genre_ids: [18, 53],
        },
        {
          id: 558,
          title: 'Another Old Movie',
          overview: 'From last year.',
          release_date: lastYear,
          poster_path: '/old2.jpg',
          vote_average: 7.0,
          vote_count: 5000,
          popularity: 30.0,
          genre_ids: [18],
        },
      ],
      total_pages: 1,
      total_results: 2,
    }

    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/search',
        response: mockJsonResponse(allOldResponse),
      },
    ])

    const req = createMockRequest({ body: { query: 'fight club' } })
    const response = await handleSearchMovies(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    // All results should be filtered out
    assertEquals(body.total_results, 0)
    assertEquals(body.results.length, 0)

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
