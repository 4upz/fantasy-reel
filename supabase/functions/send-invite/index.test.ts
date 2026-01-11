/**
 * Unit tests for send-invite Edge Function
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  createMockSupabaseClient,
  createMockAuthRequest,
  mockEnvVars,
  type MockSupabaseConfig,
} from '../_test_utils/mocks.ts'
import {
  mockUser,
  mockUser2,
  mockLeague,
  mockLeagueDrafting,
  mockInvitation,
  mockInvitationAccepted,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

async function handleSendInvite(req: Request): Promise<Response> {
  const {
    jsonResponse,
    errorResponse,
    handleCorsPreflightRequest,
    isValidUUID,
    isValidEmail,
  } = await import('../_shared/utils.ts')

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const {
      data: { user },
      error: authError,
    } = await mockClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    const { league_id, email } = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!email || !isValidEmail(email)) {
      return errorResponse('Valid email is required', 400)
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Fetch the league
    const { data: league, error: leagueError } = await mockClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Verify ownership
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can send invitations', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot send invitations - draft has already started', 400)
    }

    // Check capacity
    const { count: participantCount } = await mockClient
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('status', 'active')

    if (participantCount !== null && participantCount >= league.max_participants) {
      return errorResponse('League is full', 400)
    }

    // Check for existing invitation
    const { data: existingInvite } = await mockClient
      .from('invitations')
      .select('id, status')
      .eq('league_id', league_id)
      .eq('email', normalizedEmail)
      .single()

    if (existingInvite) {
      if (existingInvite.status === 'pending') {
        return errorResponse('An invitation has already been sent to this email', 400)
      }
      if (existingInvite.status === 'accepted') {
        return errorResponse('This user has already joined the league', 400)
      }
    }

    // Create invitation
    const { data: invitation, error: inviteError } = await mockClient
      .from('invitations')
      .insert({
        league_id,
        invited_by: user.id,
        email: normalizedEmail,
        status: 'pending',
      })
      .select()
      .single()

    if (inviteError) {
      if (inviteError.code === '23505') {
        return errorResponse('An invitation already exists for this email', 400)
      }
      return errorResponse('Failed to create invitation', 500)
    }

    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:3000'
    const inviteUrl = `${siteUrl}/join?token=${invitation.token}`

    return jsonResponse(
      {
        invitation: {
          id: invitation.id,
          league_id: invitation.league_id,
          email: invitation.email,
          token: invitation.token,
          status: invitation.status,
          expires_at: invitation.expires_at,
        },
        invite_url: inviteUrl,
        message: `Invitation created for ${normalizedEmail}`,
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
  SITE_URL: 'http://localhost:3000',
})

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test('send-invite: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: 'test@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('send-invite: validation', async (t) => {
  await t.step('returns 400 when league_id invalid', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: 'invalid',
      email: 'test@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid league_id is required')
  })

  await t.step('returns 400 when email invalid', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: 'not-an-email',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid email is required')
  })
})

// ============================================================================
// Authorization Tests
// ============================================================================

Deno.test('send-invite: authorization', async (t) => {
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

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: 'invitee@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'League not found')
  })

  await t.step('returns 403 when not league owner', async () => {
    const otherUserLeague = { ...mockLeague, owner_id: mockUser2.id }
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: otherUserLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: 'invitee@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'Only the league owner can send invitations')
  })

  await t.step('returns 400 when draft already started', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeagueDrafting, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: 'invitee@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Cannot send invitations - draft has already started')
  })
})

// ============================================================================
// Capacity and Duplicate Tests
// ============================================================================

Deno.test('send-invite: capacity', async (t) => {
  await t.step('returns 400 when league is full', async () => {
    const fullLeague = { ...mockLeague, max_participants: 2 }
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: fullLeague, error: null },
        },
        league_participants: {
          select: { data: [], error: null, count: 2 },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: 'invitee@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'League is full')
  })

  await t.step('returns 400 when pending invitation exists', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeague, error: null },
        },
        league_participants: {
          select: { data: [], error: null, count: 1 },
        },
        invitations: {
          select: { data: mockInvitation, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: mockInvitation.email,
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'An invitation has already been sent to this email')
  })

  await t.step('returns 400 when user already joined', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeague, error: null },
        },
        league_participants: {
          select: { data: [], error: null, count: 1 },
        },
        invitations: {
          select: { data: mockInvitationAccepted, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: validUUID,
      email: mockInvitationAccepted.email,
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'This user has already joined the league')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('send-invite: success', async (t) => {
  await t.step('creates invitation and returns invite URL', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        leagues: {
          select: { data: mockLeague, error: null },
        },
        league_participants: {
          select: { data: [], error: null, count: 1 },
        },
        invitations: {
          select: { data: null, error: null },
          insert: { data: mockInvitation, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      league_id: mockLeague.id,
      email: 'newinvitee@example.com',
    })
    const response = await handleSendInvite(req)

    assertEquals(response.status, 201)
    const body = await response.json()
    assertExists(body.invitation)
    assertExists(body.invite_url)
    assertExists(body.message)
    assertEquals(body.invite_url.includes('/join?token='), true)
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
