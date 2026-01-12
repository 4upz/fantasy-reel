/**
 * Unit tests for draft-pick Edge Function
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  createMockSupabaseClient,
  createMockAuthRequest,
  createMockOptionsRequest,
  mockEnvVars,
  type MockSupabaseConfig,
} from '../_test_utils/mocks.ts'
import {
  mockUser,
  mockUser2,
  mockLeague,
  mockLeagueDrafting,
  mockMovie,
  mockMovieReleased,
  mockTeam,
  mockParticipant,
  mockDraftPick,
  mockNextPickInfo,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

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
const lastYear = `${new Date().getFullYear() - 1}-06-15`

// Get a past date that's definitely in the current year (for "already released this year" tests)
function getPastDateThisYear(): string {
  const now = new Date()
  // Go back to Jan 1 of this year or yesterday, whichever is later
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(now.getDate() - 1)

  // If yesterday is before Jan 1 (shouldn't happen), just use Jan 1
  const targetDate = yesterdayDate >= jan1 ? yesterdayDate : jan1
  return targetDate.toISOString().split('T')[0]
}
const pastDateThisYear = getPastDateThisYear()

/**
 * Validates that a movie is eligible for drafting.
 */
function isValidDraftableMovie(releaseDate: string | null): { valid: boolean; reason?: string } {
  if (!releaseDate) {
    return { valid: false, reason: 'Movie has no release date' }
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const todayStr = now.toISOString().split('T')[0]

  const releaseYear = parseInt(releaseDate.split('-')[0], 10)
  if (isNaN(releaseYear) || releaseYear < currentYear) {
    return { valid: false, reason: 'Movie was released in a previous year' }
  }

  if (releaseDate < todayStr) {
    return { valid: false, reason: 'Movie has already been released' }
  }

  return { valid: true }
}

// Mock movie with upcoming release date (dynamic)
const mockUpcomingMovie = {
  ...mockMovie,
  release_date: nextMonth,
}

// Mock movie data for creating new movies (with dynamic date)
const mockMovieData = {
  title: 'New Test Movie',
  overview: 'A new movie to draft',
  poster_url: 'https://image.tmdb.org/t/p/w500/new.jpg',
  release_date: nextMonth,
  vote_average: 8.0,
  popularity: 150.0,
  genre_ids: [28, 12],
}

// Recreate handler logic for testing
async function handleDraftPick(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } =
    await import('../_shared/utils.ts')

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Validate the user
    const {
      data: { user },
      error: authError,
    } = await mockClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const { league_id, tmdb_id, movie_data } = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    // Fetch the league
    const { data: league, error: leagueError } = await mockClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Validate league status
    if (league.status !== 'drafting') {
      if (league.status === 'setup') {
        return errorResponse('Draft has not started yet', 400)
      }
      return errorResponse('Draft has already ended', 400)
    }

    // Get next pick info
    const { data: nextPickData, error: nextPickError } = await mockClient.rpc(
      'get_next_draft_pick',
      { p_league_id: league_id }
    )

    if (nextPickError) {
      return errorResponse('Failed to determine next pick', 500)
    }

    if (!nextPickData || nextPickData.length === 0) {
      return errorResponse('Draft is complete', 400)
    }

    const nextPick = nextPickData[0]

    // Verify it's the user's turn
    if (nextPick.user_id !== user.id) {
      return errorResponse('It is not your turn to pick', 403)
    }

    // Find or create movie by tmdb_id
    let movie: { id: string; title: string; poster_url: string | null; release_date: string | null; status: string }

    const { data: existingMovie, error: movieError } = await mockClient
      .from('movies')
      .select('id, title, poster_url, release_date, status')
      .eq('tmdb_id', tmdb_id)
      .single()

    if (existingMovie) {
      movie = existingMovie
    } else {
      // Movie doesn't exist, create it
      if (!movie_data) {
        return errorResponse('Movie not found and no movie_data provided', 400)
      }

      const { data: newMovie, error: insertError } = await mockClient
        .from('movies')
        .insert({
          tmdb_id,
          title: movie_data.title,
          overview: movie_data.overview || null,
          poster_url: movie_data.poster_url,
          release_date: movie_data.release_date,
          vote_average: movie_data.vote_average,
          vote_count: 0,
          popularity: movie_data.popularity,
          status: 'upcoming',
          last_synced_at: new Date().toISOString(),
        })
        .select('id, title, poster_url, release_date, status')
        .single()

      if (insertError || !newMovie) {
        return errorResponse('Failed to create movie record', 500)
      }

      movie = newMovie
    }

    // Validate movie is eligible for drafting (upcoming, current year or later)
    const draftValidation = isValidDraftableMovie(movie.release_date)
    if (!draftValidation.valid) {
      return errorResponse(
        `This movie cannot be drafted: ${draftValidation.reason}`,
        400
      )
    }

    // Check movie status (belt and suspenders with the date check above)
    if (movie.status !== 'upcoming') {
      return errorResponse('This movie is not available for drafting', 400)
    }

    // Check if movie already drafted in this league
    const { data: existingPick } = await mockClient
      .from('draft_picks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie.id)
      .single()

    if (existingPick) {
      return errorResponse('This movie has already been drafted', 400)
    }

    // Insert the draft pick
    const { data: pick, error: pickError } = await mockClient
      .from('draft_picks')
      .insert({
        league_id,
        team_id: nextPick.team_id,
        movie_id: movie.id,
        round: nextPick.round,
        pick_number: nextPick.pick_number,
      })
      .select()
      .single()

    if (pickError) {
      if (pickError.code === '23505') {
        return errorResponse('This pick slot was just taken. Please try again.', 409)
      }
      return errorResponse('Failed to record draft pick', 500)
    }

    return jsonResponse(
      {
        pick: {
          id: pick.id,
          league_id: pick.league_id,
          team_id: pick.team_id,
          movie_id: pick.movie_id,
          round: pick.round,
          pick_number: pick.pick_number,
          picked_at: pick.picked_at,
        },
        movie: {
          id: movie.id,
          tmdb_id: tmdb_id,
          title: movie.title,
          poster_url: movie.poster_url,
          release_date: movie.release_date,
        },
        next_pick: null,
        draft_complete: false,
      },
      201
    )
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
}

const cleanupEnv = mockEnvVars({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'mock-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
})

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test('draft-pick: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('draft-pick: validation', async (t) => {
  await t.step('returns 400 when league_id invalid', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: 'invalid', tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid league_id is required')
  })

  await t.step('returns 400 when tmdb_id invalid (not a number)', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 'invalid' })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 when tmdb_id is zero', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 0 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 when tmdb_id is negative', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: -1 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid tmdb_id is required')
  })
})

// ============================================================================
// League Status Tests
// ============================================================================

Deno.test('draft-pick: league status', async (t) => {
  await t.step('returns 404 when league not found', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: null, error: { message: 'Not found' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'League not found')
  })

  await t.step('returns 400 when draft has not started', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeague, error: null }, // status: 'setup'
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Draft has not started yet')
  })

  await t.step('returns 400 when draft already ended', async () => {
    const activeLeague = { ...mockLeague, status: 'active' }
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: activeLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Draft has already ended')
  })
})

// ============================================================================
// Turn Validation Tests
// ============================================================================

Deno.test('draft-pick: turn validation', async (t) => {
  await t.step('returns 403 when not user turn', async () => {
    const otherUserNextPick = { ...mockNextPickInfo, user_id: mockUser2.id }
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [otherUserNextPick], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'It is not your turn to pick')
  })

  await t.step('returns 400 when draft is complete (no more picks)', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 12345 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Draft is complete')
  })
})

// ============================================================================
// Movie Validation Tests
// ============================================================================

Deno.test('draft-pick: movie validation', async (t) => {
  await t.step('returns 400 when movie not found and no movie_data provided', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: null, error: { message: 'Not found' } },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    // No movie_data provided
    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: 99999 })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Movie not found and no movie_data provided')
  })

  await t.step('returns 400 when movie not upcoming', async () => {
    // Movie has future release date but status is already 'released' (edge case)
    const releasedMovie = { ...mockUpcomingMovie, status: 'released' }
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: releasedMovie, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: mockUpcomingMovie.tmdb_id })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie is not available for drafting')
  })

  await t.step('returns 400 when movie already drafted in this league', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: mockUpcomingMovie, error: null },
        },
        draft_picks: {
          select: { data: mockDraftPick, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, tmdb_id: mockUpcomingMovie.tmdb_id })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie has already been drafted')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('draft-pick: success', async (t) => {
  await t.step('creates draft pick with existing movie', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: mockUpcomingMovie, error: null },
        },
        draft_picks: {
          select: { data: null, error: null },
          insert: { data: mockDraftPick, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.pick)
    assertExists(body.movie)
    assertEquals(body.movie.title, mockUpcomingMovie.title)
    assertEquals(body.movie.tmdb_id, mockUpcomingMovie.tmdb_id)
  })

  await t.step('creates movie and draft pick when movie does not exist', async () => {
    const newMovieId = 'f1e2d3c4-b5a6-7890-1234-567890abcdef'
    const newTmdbId = 99999
    const createdMovie = {
      id: newMovieId,
      title: mockMovieData.title,
      poster_url: mockMovieData.poster_url,
      release_date: mockMovieData.release_date,
      status: 'upcoming',
    }
    const newDraftPick = {
      ...mockDraftPick,
      movie_id: newMovieId,
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: null, error: { message: 'Not found' } },
          insert: { data: createdMovie, error: null },
        },
        draft_picks: {
          select: { data: null, error: null },
          insert: { data: newDraftPick, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: newTmdbId,
      movie_data: mockMovieData,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.pick)
    assertExists(body.movie)
    assertEquals(body.movie.title, mockMovieData.title)
    assertEquals(body.movie.tmdb_id, newTmdbId)
  })

  await t.step('accepts movie releasing today', async () => {
    const todayMovie = {
      ...mockUpcomingMovie,
      id: 'e8f9a0b1-c2d3-4567-89ab-cdef01234567',
      release_date: today,
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: todayMovie, error: null },
        },
        draft_picks: {
          select: { data: null, error: null },
          insert: { data: { ...mockDraftPick, movie_id: todayMovie.id }, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 201)
  })
})

// ============================================================================
// Release Date Validation Tests
// ============================================================================

Deno.test('draft-pick: release date validation', async (t) => {
  await t.step('rejects existing movie from previous year', async () => {
    const oldMovie = {
      ...mockUpcomingMovie,
      release_date: lastYear,
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: oldMovie, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie cannot be drafted: Movie was released in a previous year')
  })

  await t.step('rejects movie already released this year', async () => {
    const releasedMovie = {
      ...mockUpcomingMovie,
      release_date: pastDateThisYear,
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: releasedMovie, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie cannot be drafted: Movie has already been released')
  })

  await t.step('rejects movie with null release_date', async () => {
    const noDateMovie = {
      ...mockUpcomingMovie,
      release_date: null,
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: noDateMovie, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie cannot be drafted: Movie has no release date')
  })

  await t.step('rejects movie_data with past release date', async () => {
    const newMovieId = 'f1e2d3c4-b5a6-7890-1234-567890abcdef'
    const pastMovieData = {
      ...mockMovieData,
      release_date: lastYear,
    }
    const createdMovie = {
      id: newMovieId,
      title: pastMovieData.title,
      poster_url: pastMovieData.poster_url,
      release_date: pastMovieData.release_date,
      status: 'upcoming',
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: null, error: { message: 'Not found' } },
          insert: { data: createdMovie, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: 99999,
      movie_data: pastMovieData,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie cannot be drafted: Movie was released in a previous year')
  })

  await t.step('rejects movie released yesterday', async () => {
    const yesterdayMovie = {
      ...mockUpcomingMovie,
      release_date: yesterday,
    }

    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: yesterdayMovie, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie cannot be drafted: Movie has already been released')
  })
})

// ============================================================================
// Race Condition Tests
// ============================================================================

Deno.test('draft-pick: race condition', async (t) => {
  await t.step('returns 409 on unique constraint violation', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: mockUpcomingMovie, error: null },
        },
        draft_picks: {
          select: { data: null, error: null },
          insert: { data: null, error: { message: 'Duplicate', code: '23505' } },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeagueDrafting.id,
      tmdb_id: mockUpcomingMovie.tmdb_id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 409)
    const body = await response.json()
    assertEquals(body.error, 'This pick slot was just taken. Please try again.')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
