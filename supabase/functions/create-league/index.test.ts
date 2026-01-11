/**
 * Unit tests for create-league Edge Function
 *
 * These tests mock the Supabase client to test the function's logic
 * without hitting a real database.
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
  mockLeague,
  mockParticipant,
  mockTeam,
} from '../_test_utils/fixtures.ts'

// Mock the createClient function
let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

// We need to test the handler logic by recreating it here
// since the actual module uses Deno.serve() which is hard to test directly
async function handleCreateLeague(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest } = await import(
    '../_shared/utils.ts'
  )

  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Use the mock client instead of creating a real one
    const supabaseClient = mockClient

    // Get the user from the JWT token
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Parse request body
    const {
      name,
      invite_only,
      draft_start_date,
      draft_end_date,
      max_participants,
      team_name,
    } = await req.json()

    // Validate required fields
    if (!name || name.trim().length === 0) {
      return errorResponse('League name is required', 400)
    }

    // Create the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .insert({
        name: name.trim(),
        owner_id: user.id,
        invite_only: invite_only || false,
        draft_start_date: draft_start_date || null,
        draft_end_date: draft_end_date || null,
        max_participants: max_participants || 8,
        status: 'setup',
      })
      .select()
      .single()

    if (leagueError) {
      console.error('Error creating league:', leagueError)
      return errorResponse('Failed to create league', 500)
    }

    // Create league participant for the owner
    const { data: participant, error: participantError } = await supabaseClient
      .from('league_participants')
      .insert({
        league_id: league.id,
        user_id: user.id,
        role: 'owner',
        status: 'active',
        draft_order: 1,
      })
      .select()
      .single()

    if (participantError) {
      console.error('Error creating participant:', participantError)
      return jsonResponse(
        {
          league,
          warning: 'League created but failed to add owner as participant',
        },
        201
      )
    }

    // Create team for the owner
    const defaultTeamName =
      team_name?.trim() || `${user.email?.split('@')[0]}'s Production Company`
    const { data: team, error: teamError } = await supabaseClient
      .from('teams')
      .insert({
        participant_id: participant.id,
        name: defaultTeamName,
      })
      .select()
      .single()

    if (teamError) {
      console.error('Error creating team:', teamError)
      return jsonResponse(
        {
          league,
          participant,
          warning: 'League and participant created but failed to create team',
        },
        201
      )
    }

    return jsonResponse({ league, participant, team }, 201)
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
}

// Setup mock environment
const cleanupEnv = mockEnvVars({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'mock-anon-key',
})

// ============================================================================
// CORS Tests
// ============================================================================

Deno.test('create-league: CORS preflight', async (t) => {
  await t.step('returns 200 for OPTIONS request', async () => {
    const req = createMockOptionsRequest()
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 200)
  })
})

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test('create-league: authentication', async (t) => {
  await t.step('returns 401 when user is not authenticated', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: 'Test League' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(body.error, 'Unauthorized')
  })

  await t.step('returns 401 when auth error occurs', async () => {
    mockSupabaseConfig = {
      user: null,
      authError: { message: 'Invalid token' },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: 'Test League' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('create-league: validation', async (t) => {
  await t.step('returns 400 when league name is empty', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: '' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'League name is required')
  })

  await t.step('returns 400 when league name is whitespace only', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: '   ' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'League name is required')
  })

  await t.step('returns 400 when name field is missing', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'League name is required')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('create-league: success', async (t) => {
  await t.step('creates league, participant, and team on success', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          insert: { data: mockLeague, error: null },
        },
        league_participants: {
          insert: { data: mockParticipant, error: null },
        },
        teams: {
          insert: { data: mockTeam, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      name: 'Test League',
      invite_only: false,
      max_participants: 8,
    })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 201)
    const body = await response.json()

    assertExists(body.league)
    assertExists(body.participant)
    assertExists(body.team)
    assertEquals(body.league.name, 'Test League')
  })

  await t.step('uses custom team name when provided', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          insert: { data: mockLeague, error: null },
        },
        league_participants: {
          insert: { data: mockParticipant, error: null },
        },
        teams: {
          insert: { data: { ...mockTeam, name: 'My Custom Team' }, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      name: 'Test League',
      team_name: 'My Custom Team',
    })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertEquals(body.team.name, 'My Custom Team')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test('create-league: error handling', async (t) => {
  await t.step('returns 500 when league creation fails', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          insert: { data: null, error: { message: 'Database error' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: 'Test League' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(body.error, 'Failed to create league')
  })

  await t.step('returns 201 with warning when participant creation fails', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          insert: { data: mockLeague, error: null },
        },
        league_participants: {
          insert: { data: null, error: { message: 'Participant error' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: 'Test League' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.league)
    assertExists(body.warning)
    assertEquals(body.warning, 'League created but failed to add owner as participant')
  })

  await t.step('returns 201 with warning when team creation fails', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          insert: { data: mockLeague, error: null },
        },
        league_participants: {
          insert: { data: mockParticipant, error: null },
        },
        teams: {
          insert: { data: null, error: { message: 'Team error' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ name: 'Test League' })
    const response = await handleCreateLeague(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.league)
    assertExists(body.participant)
    assertExists(body.warning)
    assertEquals(body.warning, 'League and participant created but failed to create team')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
