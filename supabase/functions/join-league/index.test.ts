/**
 * Unit tests for join-league Edge Function
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
  mockLeagueInviteOnly,
  mockLeagueDrafting,
  mockParticipant,
  mockParticipant2,
  mockTeam2,
  mockInvitation,
  mockInvitationExpired,
  mockInvitationAccepted,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

// Recreate handler logic for testing
async function handleJoinLeague(req: Request): Promise<Response> {
  const { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } =
    await import('../_shared/utils.ts')

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabaseClient = mockClient

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const { league_id, invitation_token, team_name } = await req.json()

    if (!league_id && !invitation_token) {
      return errorResponse('Either league_id or invitation_token is required', 400)
    }

    let targetLeagueId: string

    // Handle invitation token flow
    if (invitation_token) {
      if (!isValidUUID(invitation_token)) {
        return errorResponse('Invalid invitation token', 400)
      }

      const { data: invitation, error: inviteError } = await supabaseClient
        .from('invitations')
        .select('*')
        .eq('token', invitation_token)
        .single()

      if (inviteError || !invitation) {
        return errorResponse('Invalid or expired invitation', 404)
      }

      if (invitation.status !== 'pending') {
        return errorResponse(`Invitation has already been ${invitation.status}`, 400)
      }

      if (new Date(invitation.expires_at) < new Date()) {
        return errorResponse('Invitation has expired', 400)
      }

      if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
        return errorResponse('This invitation was sent to a different email address', 403)
      }

      targetLeagueId = invitation.league_id

      await supabaseClient
        .from('invitations')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString(),
        })
        .eq('id', invitation.id)
    } else {
      if (!isValidUUID(league_id!)) {
        return errorResponse('Invalid league_id', 400)
      }
      targetLeagueId = league_id!
    }

    // Fetch the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('*')
      .eq('id', targetLeagueId)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (!invitation_token && league.invite_only) {
      return errorResponse('This league is invite-only', 403)
    }

    if (league.status !== 'setup') {
      return errorResponse('Cannot join league - draft has already started', 400)
    }

    // Check if user is already a participant
    const { data: existingParticipant } = await supabaseClient
      .from('league_participants')
      .select('id')
      .eq('league_id', targetLeagueId)
      .eq('user_id', user.id)
      .single()

    if (existingParticipant) {
      return errorResponse('You are already a member of this league', 400)
    }

    // Check capacity
    const { count: participantCount } = await supabaseClient
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', targetLeagueId)
      .eq('status', 'active')

    if (participantCount !== null && participantCount >= league.max_participants) {
      return errorResponse('League is full', 400)
    }

    const draftOrder = (participantCount || 0) + 1

    // Create participant
    const { data: participant, error: participantError } = await supabaseClient
      .from('league_participants')
      .insert({
        league_id: targetLeagueId,
        user_id: user.id,
        role: 'member',
        status: 'active',
        draft_order: draftOrder,
      })
      .select()
      .single()

    if (participantError) {
      return errorResponse('Failed to join league', 500)
    }

    // Create team
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
      return jsonResponse(
        {
          participant,
          league: { id: league.id, name: league.name },
          warning: 'Joined league but failed to create team',
        },
        201
      )
    }

    return jsonResponse(
      {
        participant,
        team,
        league: { id: league.id, name: league.name },
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
})

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test('join-league: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('join-league: validation', async (t) => {
  await t.step('returns 400 when neither league_id nor invitation_token provided', async () => {
    mockSupabaseConfig = { user: mockUser2 }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Either league_id or invitation_token is required')
  })

  await t.step('returns 400 when league_id is invalid UUID', async () => {
    mockSupabaseConfig = { user: mockUser2 }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: 'invalid' })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invalid league_id')
  })

  await t.step('returns 400 when invitation_token is invalid UUID', async () => {
    mockSupabaseConfig = { user: mockUser2 }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ invitation_token: 'invalid' })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invalid invitation token')
  })
})

// ============================================================================
// Invitation Flow Tests
// ============================================================================

Deno.test('join-league: invitation flow', async (t) => {
  await t.step('returns 404 when invitation token not found', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        invitations: {
          select: { data: null, error: { message: 'Not found' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ invitation_token: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'Invalid or expired invitation')
  })

  await t.step('returns 400 when invitation already accepted', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        invitations: {
          select: { data: mockInvitationAccepted, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ invitation_token: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invitation has already been accepted')
  })

  await t.step('returns 400 when invitation expired', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        invitations: {
          select: { data: mockInvitationExpired, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ invitation_token: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invitation has expired')
  })

  await t.step('returns 403 when email does not match invitation', async () => {
    const invitationForDifferentUser = {
      ...mockInvitation,
      email: 'different@example.com',
    }
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        invitations: {
          select: { data: invitationForDifferentUser, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ invitation_token: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'This invitation was sent to a different email address')
  })
})

// ============================================================================
// Direct Join Tests
// ============================================================================

Deno.test('join-league: direct join', async (t) => {
  await t.step('returns 404 when league not found', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        leagues: {
          select: { data: null, error: { message: 'Not found' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'League not found')
  })

  await t.step('returns 403 when league is invite-only', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        leagues: {
          select: { data: mockLeagueInviteOnly, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'This league is invite-only')
  })

  await t.step('returns 400 when draft has started', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Cannot join league - draft has already started')
  })

  await t.step('returns 400 when user already a member', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        leagues: {
          select: { data: mockLeague, error: null },
        },
        league_participants: {
          select: { data: mockParticipant2, error: null, count: 1 },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({ league_id: validUUID })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'You are already a member of this league')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('join-league: success', async (t) => {
  await t.step('creates participant and team on direct join', async () => {
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        leagues: {
          select: { data: mockLeague, error: null, count: 1 },
        },
        league_participants: {
          select: { data: null, error: null, count: 1 },
          insert: { data: mockParticipant2, error: null },
        },
        teams: {
          insert: { data: mockTeam2, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeague.id,
      team_name: 'My Team',
    })
    const response = await handleJoinLeague(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.participant)
    assertExists(body.team)
    assertExists(body.league)
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
