/**
 * Unit tests for update-scores Edge Function
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
import {
  mockMovie,
  mockMovieNoImdb,
  mockOMDbResponse,
  mockOMDbErrorResponse,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>
let cleanupFetch: (() => void) | null = null

// Helper functions from the actual module
function normalizeScore(source: string, value: string): number | null {
  try {
    switch (source) {
      case 'Internet Movie Database': {
        const imdbMatch = value.match(/^([\d.]+)\/10$/)
        if (imdbMatch) {
          return Math.round(parseFloat(imdbMatch[1]) * 10)
        }
        break
      }
      case 'Rotten Tomatoes': {
        const rtMatch = value.match(/^(\d+)%$/)
        if (rtMatch) {
          return parseInt(rtMatch[1])
        }
        break
      }
      case 'Metacritic': {
        const mcMatch = value.match(/^(\d+)\/100$/)
        if (mcMatch) {
          return parseInt(mcMatch[1])
        }
        break
      }
    }
  } catch {
    // Parse error
  }
  return null
}

function mapSourceKey(omdbSource: string): string | null {
  switch (omdbSource) {
    case 'Internet Movie Database':
      return 'imdb'
    case 'Rotten Tomatoes':
      return 'rotten_tomatoes'
    case 'Metacritic':
      return 'metacritic'
    default:
      return null
  }
}

// Simplified handler for testing
async function handleUpdateScores(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } =
    await import('../_shared/utils.ts')

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const omdbApiKey = Deno.env.get('OMDB_API_KEY')
    if (!omdbApiKey) {
      return errorResponse('Score update service not configured', 503)
    }

    let params: { movie_ids?: string[]; league_id?: string } = {}
    try {
      if (req.method === 'POST') {
        const body = await req.text()
        if (body) {
          params = JSON.parse(body)
        }
      }
    } catch {
      // Ignore
    }

    let moviesToUpdate: Array<{ id: string; imdb_id: string | null; title: string }> =
      []

    if (params.movie_ids && params.movie_ids.length > 0) {
      const validIds = params.movie_ids.filter((id) => isValidUUID(id))
      if (validIds.length === 0) {
        return errorResponse('No valid movie_ids provided', 400)
      }

      const { data, error } = await mockClient
        .from('movies')
        .select('id, imdb_id, title')
        .in('id', validIds)

      if (error) {
        return errorResponse('Failed to fetch movies', 500)
      }
      moviesToUpdate = data || []
    } else {
      // Default: get released movies
      const { data, error } = await mockClient
        .from('movies')
        .select('id, imdb_id, title')
        .eq('status', 'released')
        .limit(50)

      if (error) {
        return errorResponse('Failed to fetch movies', 500)
      }
      moviesToUpdate = data || []
    }

    if (moviesToUpdate.length === 0) {
      return jsonResponse({
        movies_fetched: 0,
        reviews_updated: 0,
        teams_recalculated: 0,
        errors: [],
      })
    }

    const results = {
      movies_fetched: 0,
      reviews_updated: 0,
      teams_recalculated: 0,
      errors: [] as Array<{ movie_id: string; title: string; error: string }>,
    }

    for (const movie of moviesToUpdate) {
      if (!movie.imdb_id) {
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'No IMDB ID available',
        })
        continue
      }

      try {
        const omdbUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${movie.imdb_id}`
        const omdbResponse = await fetch(omdbUrl)

        if (!omdbResponse.ok) {
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: `OMDb API error: ${omdbResponse.status}`,
          })
          continue
        }

        const omdbData = await omdbResponse.json()

        if (omdbData.Response === 'False') {
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: omdbData.Error || 'Movie not found on OMDb',
          })
          continue
        }

        results.movies_fetched++

        if (omdbData.Ratings && omdbData.Ratings.length > 0) {
          for (const rating of omdbData.Ratings) {
            const sourceKey = mapSourceKey(rating.Source)
            if (!sourceKey) continue

            const normalizedScore = normalizeScore(rating.Source, rating.Value)
            if (normalizedScore === null) continue

            const { error: reviewError } = await mockClient
              .from('reviews')
              .upsert(
                {
                  movie_id: movie.id,
                  source: sourceKey,
                  score: normalizedScore,
                  raw_score: rating.Value,
                  fetched_at: new Date().toISOString(),
                },
                { onConflict: 'movie_id,source' }
              )

            if (!reviewError) {
              results.reviews_updated++
            }
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

    return jsonResponse(results)
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
}

const cleanupEnv = mockEnvVars({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
  OMDB_API_KEY: 'mock-omdb-key',
})

// ============================================================================
// Score Normalization Tests
// ============================================================================

Deno.test('update-scores: normalizeScore', async (t) => {
  await t.step('normalizes IMDb scores correctly', () => {
    assertEquals(normalizeScore('Internet Movie Database', '8.5/10'), 85)
    assertEquals(normalizeScore('Internet Movie Database', '7.0/10'), 70)
    assertEquals(normalizeScore('Internet Movie Database', '10.0/10'), 100)
    assertEquals(normalizeScore('Internet Movie Database', '0.0/10'), 0)
    assertEquals(normalizeScore('Internet Movie Database', '9.3/10'), 93)
  })

  await t.step('normalizes Rotten Tomatoes scores correctly', () => {
    assertEquals(normalizeScore('Rotten Tomatoes', '85%'), 85)
    assertEquals(normalizeScore('Rotten Tomatoes', '100%'), 100)
    assertEquals(normalizeScore('Rotten Tomatoes', '0%'), 0)
    assertEquals(normalizeScore('Rotten Tomatoes', '42%'), 42)
  })

  await t.step('normalizes Metacritic scores correctly', () => {
    assertEquals(normalizeScore('Metacritic', '78/100'), 78)
    assertEquals(normalizeScore('Metacritic', '100/100'), 100)
    assertEquals(normalizeScore('Metacritic', '0/100'), 0)
    assertEquals(normalizeScore('Metacritic', '55/100'), 55)
  })

  await t.step('returns null for invalid formats', () => {
    assertEquals(normalizeScore('Internet Movie Database', 'invalid'), null)
    assertEquals(normalizeScore('Rotten Tomatoes', '85'), null)
    assertEquals(normalizeScore('Metacritic', '78'), null)
    assertEquals(normalizeScore('Unknown Source', '85%'), null)
  })
})

// ============================================================================
// Source Key Mapping Tests
// ============================================================================

Deno.test('update-scores: mapSourceKey', async (t) => {
  await t.step('maps source keys correctly', () => {
    assertEquals(mapSourceKey('Internet Movie Database'), 'imdb')
    assertEquals(mapSourceKey('Rotten Tomatoes'), 'rotten_tomatoes')
    assertEquals(mapSourceKey('Metacritic'), 'metacritic')
    assertEquals(mapSourceKey('Unknown'), null)
  })
})

// ============================================================================
// Configuration Tests
// ============================================================================

Deno.test('update-scores: configuration', async (t) => {
  await t.step('returns 503 when OMDB_API_KEY not configured', async () => {
    const restoreEnv = mockEnvVars({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
      // No OMDB_API_KEY
    })

    const req = createMockAuthRequest({})
    const response = await handleUpdateScores(req)

    assertEquals(response.status, 503)
    const body = await response.json()
    assertEquals(body.error, 'Score update service not configured')

    restoreEnv()
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('update-scores: validation', async (t) => {
  await t.step('returns 400 when invalid movie_ids provided', async () => {
    mockSupabaseConfig = {}
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      movie_ids: ['invalid-1', 'invalid-2'],
    })
    const response = await handleUpdateScores(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'No valid movie_ids provided')
  })
})

// ============================================================================
// Movie Processing Tests
// ============================================================================

Deno.test('update-scores: movie processing', async (t) => {
  await t.step('skips movies without imdb_id', async () => {
    mockSupabaseConfig = {
      tables: {
        movies: {
          select: { data: [mockMovieNoImdb], error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      movie_ids: [mockMovieNoImdb.id],
    })
    const response = await handleUpdateScores(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.movies_fetched, 0)
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'No IMDB ID available')
  })

  await t.step('returns empty result when no movies to process', async () => {
    mockSupabaseConfig = {
      tables: {
        movies: {
          select: { data: [], error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ movie_ids: [validUUID] })
    const response = await handleUpdateScores(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.movies_fetched, 0)
    assertEquals(body.reviews_updated, 0)
  })
})

// ============================================================================
// OMDb API Tests
// ============================================================================

Deno.test('update-scores: OMDb API', async (t) => {
  await t.step('handles OMDb movie not found', async () => {
    mockSupabaseConfig = {
      tables: {
        movies: {
          select: { data: [mockMovie], error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    cleanupFetch = mockFetch([
      {
        url: 'omdbapi.com',
        response: mockJsonResponse(mockOMDbErrorResponse),
      },
    ])

    const req = createMockAuthRequest({ movie_ids: [mockMovie.id] })
    const response = await handleUpdateScores(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.movies_fetched, 0)
    assertEquals(body.errors.length, 1)
    assertEquals(body.errors[0].error, 'Movie not found!')

    cleanupFetch()
  })

  await t.step('processes ratings and updates reviews', async () => {
    mockSupabaseConfig = {
      tables: {
        movies: {
          select: { data: [mockMovie], error: null },
        },
        reviews: {
          upsert: { data: null, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    cleanupFetch = mockFetch([
      {
        url: 'omdbapi.com',
        response: mockJsonResponse(mockOMDbResponse),
      },
    ])

    const req = createMockAuthRequest({ movie_ids: [mockMovie.id] })
    const response = await handleUpdateScores(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.movies_fetched, 1)
    // 3 ratings: IMDb, RT, Metacritic
    assertEquals(body.reviews_updated, 3)
    assertEquals(body.errors.length, 0)

    cleanupFetch()
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
  if (cleanupFetch) cleanupFetch()
})
