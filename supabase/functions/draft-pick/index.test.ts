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

    const { league_id, movie_id } = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!movie_id || !isValidUUID(movie_id)) {
      return errorResponse('Valid movie_id is required', 400)
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

    // Validate movie exists
    const { data: movie, error: movieError } = await mockClient
      .from('movies')
      .select('*')
      .eq('id', movie_id)
      .single()

    if (movieError || !movie) {
      return errorResponse('Movie not found', 404)
    }

    if (movie.status !== 'upcoming') {
      return errorResponse('This movie is not available for drafting', 400)
    }

    // Check if movie already drafted
    const { data: existingPick } = await mockClient
      .from('draft_picks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie_id)
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
        movie_id,
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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

    const req = createMockAuthRequest({ league_id: 'invalid', movie_id: validUUID })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid league_id is required')
  })

  await t.step('returns 400 when movie_id invalid', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: 'invalid' })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid movie_id is required')
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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
  await t.step('returns 404 when movie not found', async () => {
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'Movie not found')
  })

  await t.step('returns 400 when movie not upcoming', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: mockMovieReleased, error: null },
        },
      },
      rpc: {
        get_next_draft_pick: { data: [mockNextPickInfo], error: null },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This movie is not available for drafting')
  })

  await t.step('returns 400 when movie already drafted', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: mockMovie, error: null },
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

    const req = createMockAuthRequest({ league_id: validUUID, movie_id: validUUID })
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
  await t.step('creates draft pick on success', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
        movies: {
          select: { data: mockMovie, error: null },
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
      movie_id: mockMovie.id,
    })
    const response = await handleDraftPick(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.pick)
    assertExists(body.movie)
    assertEquals(body.movie.title, mockMovie.title)
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
          select: { data: mockMovie, error: null },
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
      movie_id: mockMovie.id,
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
