/**
 * Unit tests for get-movie-details Edge Function
 */

import { assertEquals } from '@std/assert'
import {
  createMockRequest,
  mockEnvVars,
  mockFetch,
  mockJsonResponse,
} from '../_test_utils/mocks.ts'
import {
  mockTMDbMovieDetailsResponse,
  mockTMDbCreditsResponse,
} from '../_test_utils/fixtures.ts'

let cleanupFetch: (() => void) | null = null

// Recreate handler logic for testing
async function handleGetMovieDetails(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest } = await import(
    '../_shared/utils.ts'
  )

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      return errorResponse('Movie details service not configured', 503)
    }

    let params: { tmdb_id?: number }
    try {
      params = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { tmdb_id } = params

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    const authHeaders = {
      'Authorization': `Bearer ${tmdbToken}`,
      'Content-Type': 'application/json',
    }

    // Fetch movie details
    const detailsUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}?language=en-US`
    const detailsResponse = await fetch(detailsUrl, { headers: authHeaders })

    if (!detailsResponse.ok) {
      if (detailsResponse.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (detailsResponse.status === 404) {
        return errorResponse('Movie not found', 404)
      }
      if (detailsResponse.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      return errorResponse('Failed to fetch movie details', 502)
    }

    const movieDetails = await detailsResponse.json()

    // Fetch credits
    const creditsUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}/credits?language=en-US`
    const creditsResponse = await fetch(creditsUrl, { headers: authHeaders })

    let credits: any = null
    if (creditsResponse.ok) {
      credits = await creditsResponse.json()
    }

    // Get top 10 cast members
    const cast = (credits?.cast || []).slice(0, 10).map((member: any) => ({
      id: member.id,
      name: member.name,
      character: member.character,
      profile_url: member.profile_path
        ? `https://image.tmdb.org/t/p/w185${member.profile_path}`
        : null,
    }))

    // Get director from crew
    const director = credits?.crew?.find((c: any) => c.job === 'Director')?.name || null

    return jsonResponse({
      tmdb_id: movieDetails.id,
      imdb_id: movieDetails.imdb_id,
      title: movieDetails.title,
      tagline: movieDetails.tagline,
      overview: movieDetails.overview,
      release_date: movieDetails.release_date,
      runtime: movieDetails.runtime,
      status: movieDetails.status,
      poster_url: movieDetails.poster_path
        ? `https://image.tmdb.org/t/p/w500${movieDetails.poster_path}`
        : null,
      backdrop_url: movieDetails.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movieDetails.backdrop_path}`
        : null,
      vote_average: movieDetails.vote_average,
      vote_count: movieDetails.vote_count,
      genres: movieDetails.genres,
      cast,
      director,
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

Deno.test('get-movie-details: configuration', async (t) => {
  await t.step('returns 503 when TMDB_API_KEY not configured', async () => {
    const restoreEnv = mockEnvVars({})

    const req = createMockRequest({ body: { tmdb_id: 550 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 503)
    const body = await response.json()
    assertEquals(body.error, 'Movie details service not configured')

    restoreEnv()
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('get-movie-details: validation', async (t) => {
  await t.step('returns 400 when tmdb_id is missing', async () => {
    const req = createMockRequest({ body: {} })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 when tmdb_id is not a number', async () => {
    const req = createMockRequest({ body: { tmdb_id: 'abc' } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 when tmdb_id is zero', async () => {
    const req = createMockRequest({ body: { tmdb_id: 0 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 when tmdb_id is negative', async () => {
    const req = createMockRequest({ body: { tmdb_id: -1 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 on invalid JSON body', async () => {
    const req = new Request('http://localhost/test', {
      method: 'POST',
      body: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invalid JSON body')
  })
})

// ============================================================================
// TMDb API Tests
// ============================================================================

Deno.test('get-movie-details: TMDb API', async (t) => {
  await t.step('returns 401 on TMDb auth failure', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/movie/',
        response: new Response('Unauthorized', { status: 401 }),
      },
    ])

    const req = createMockRequest({ body: { tmdb_id: 550 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(body.error, 'TMDb API authentication failed')

    cleanupFetch()
  })

  await t.step('returns 404 when movie not found', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/movie/',
        response: new Response('Not found', { status: 404 }),
      },
    ])

    const req = createMockRequest({ body: { tmdb_id: 999999999 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'Movie not found')

    cleanupFetch()
  })

  await t.step('returns 429 on TMDb rate limit', async () => {
    cleanupFetch = mockFetch([
      {
        url: 'api.themoviedb.org/3/movie/',
        response: new Response('Rate limited', { status: 429 }),
      },
    ])

    const req = createMockRequest({ body: { tmdb_id: 550 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 429)
    const body = await response.json()
    assertEquals(body.error, 'TMDb rate limit exceeded. Try again later.')

    cleanupFetch()
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('get-movie-details: success', async (t) => {
  await t.step('returns full movie details with cast', async () => {
    cleanupFetch = mockFetch([
      {
        url: /api\.themoviedb\.org\/3\/movie\/550\?/,
        response: mockJsonResponse(mockTMDbMovieDetailsResponse),
      },
      {
        url: /api\.themoviedb\.org\/3\/movie\/550\/credits/,
        response: mockJsonResponse(mockTMDbCreditsResponse),
      },
    ])

    const req = createMockRequest({ body: { tmdb_id: 550 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    // Check basic movie info
    assertEquals(body.tmdb_id, 550)
    assertEquals(body.title, 'Fight Club')
    assertEquals(body.tagline, 'Mischief. Mayhem. Soap.')
    assertEquals(body.runtime, 139)
    assertEquals(body.imdb_id, 'tt0137523')

    // Check URL transformations
    assertEquals(body.poster_url, 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg')
    assertEquals(body.backdrop_url, 'https://image.tmdb.org/t/p/original/hZkgoQYus5vegHoetLkCJzb17zJ.jpg')

    // Check genres
    assertEquals(body.genres.length, 2)
    assertEquals(body.genres[0].name, 'Drama')

    // Check cast
    assertEquals(body.cast.length, 3)
    assertEquals(body.cast[0].name, 'Edward Norton')
    assertEquals(body.cast[0].character, 'The Narrator')
    assertEquals(body.cast[0].profile_url, 'https://image.tmdb.org/t/p/w185/5XBzD5WuTyVQZeS4II6gs1nn5P6.jpg')

    // Check director
    assertEquals(body.director, 'David Fincher')

    cleanupFetch()
  })

  await t.step('handles missing credits gracefully', async () => {
    cleanupFetch = mockFetch([
      {
        url: /api\.themoviedb\.org\/3\/movie\/550\?/,
        response: mockJsonResponse(mockTMDbMovieDetailsResponse),
      },
      {
        url: /api\.themoviedb\.org\/3\/movie\/550\/credits/,
        response: new Response('Not found', { status: 404 }),
      },
    ])

    const req = createMockRequest({ body: { tmdb_id: 550 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.title, 'Fight Club')
    assertEquals(body.cast, [])
    assertEquals(body.director, null)

    cleanupFetch()
  })

  await t.step('handles null poster path', async () => {
    const movieWithNoPoster = {
      ...mockTMDbMovieDetailsResponse,
      poster_path: null,
      backdrop_path: null,
    }

    cleanupFetch = mockFetch([
      {
        url: /api\.themoviedb\.org\/3\/movie\/550\?/,
        response: mockJsonResponse(movieWithNoPoster),
      },
      {
        url: /api\.themoviedb\.org\/3\/movie\/550\/credits/,
        response: mockJsonResponse(mockTMDbCreditsResponse),
      },
    ])

    const req = createMockRequest({ body: { tmdb_id: 550 } })
    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 200)
    const body = await response.json()

    assertEquals(body.poster_url, null)
    assertEquals(body.backdrop_url, null)

    cleanupFetch()
  })
})

// ============================================================================
// CORS Tests
// ============================================================================

Deno.test('get-movie-details: CORS', async (t) => {
  await t.step('handles OPTIONS preflight request', async () => {
    const req = new Request('http://localhost/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    })

    const response = await handleGetMovieDetails(req)

    assertEquals(response.status, 200)
    assertEquals(response.headers.get('Access-Control-Allow-Origin'), '*')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
  if (cleanupFetch) cleanupFetch()
})
