/**
 * Unit tests for cancel-invitation Edge Function
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
  mockInvitation,
  mockInvitationAccepted,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

// Mock invitation with league owner info
const mockInvitationWithLeague = {
  ...mockInvitation,
  leagues: { owner_id: mockUser.id },
}

const mockInvitationAcceptedWithLeague = {
  ...mockInvitationAccepted,
  leagues: { owner_id: mockUser.id },
}

const mockCancelledInvitation = {
  id: mockInvitation.id,
  league_id: mockInvitation.league_id,
  email: mockInvitation.email,
  status: 'cancelled',
  responded_at: new Date().toISOString(),
}

async function handleCancelInvitation(req: Request): Promise<Response> {
  const {
    jsonResponse,
    errorResponse,
    handleCorsPreflightRequest,
    isValidUUID,
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

    const { invitation_id } = await req.json()

    if (!invitation_id || !isValidUUID(invitation_id)) {
      return errorResponse('Valid invitation_id is required', 400)
    }

    // Get invitation with league info to verify ownership
    const { data: invitation, error: invitationError } = await mockClient
      .from('invitations')
      .select('*')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    // Verify user is the league owner
    const leagueData = invitation.leagues as { owner_id: string } | null
    if (!leagueData || leagueData.owner_id !== user.id) {
      return errorResponse('Only the league owner can cancel invitations', 403)
    }

    if (invitation.status !== 'pending') {
      return errorResponse(`Invitation has already been ${invitation.status}`, 400)
    }

    // Update invitation status to cancelled
    const { data: updatedInvitation, error: updateError } = await mockClient
      .from('invitations')
      .update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
      })
      .eq('id', invitation_id)
      .select()
      .single()

    if (updateError) {
      return errorResponse('Failed to cancel invitation', 500)
    }

    return jsonResponse({
      invitation: {
        id: updatedInvitation.id,
        league_id: updatedInvitation.league_id,
        email: updatedInvitation.email,
        status: updatedInvitation.status,
        responded_at: updatedInvitation.responded_at,
      },
      message: 'Invitation cancelled successfully',
    })
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

Deno.test('cancel-invitation: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: validUUID,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('cancel-invitation: validation', async (t) => {
  await t.step('returns 400 when invitation_id missing', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid invitation_id is required')
  })

  await t.step('returns 400 when invitation_id invalid', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: 'invalid',
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid invitation_id is required')
  })
})

// ============================================================================
// Authorization Tests
// ============================================================================

Deno.test('cancel-invitation: authorization', async (t) => {
  await t.step('returns 404 when invitation not found', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: null, error: { message: 'Not found' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: validUUID,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'Invitation not found')
  })

  await t.step('returns 403 when user is not the league owner', async () => {
    // mockUser2 is not the owner of the league
    mockSupabaseConfig = {
      user: mockUser2,
      tables: {
        invitations: {
          select: { data: mockInvitationWithLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'Only the league owner can cancel invitations')
  })

  await t.step('returns 403 when league info is null', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: { ...mockInvitation, leagues: null }, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'Only the league owner can cancel invitations')
  })
})

// ============================================================================
// Status Validation Tests
// ============================================================================

Deno.test('cancel-invitation: status checks', async (t) => {
  await t.step('returns 400 when invitation already accepted', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationAcceptedWithLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitationAccepted.id,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invitation has already been accepted')
  })

  await t.step('returns 400 when invitation already declined', async () => {
    const mockDeclinedWithLeague = {
      ...mockInvitation,
      status: 'declined',
      leagues: { owner_id: mockUser.id },
    }
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockDeclinedWithLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invitation has already been declined')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('cancel-invitation: success', async (t) => {
  await t.step('cancels invitation and returns updated data', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationWithLeague, error: null },
          update: { data: mockCancelledInvitation, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertExists(body.invitation)
    assertEquals(body.invitation.status, 'cancelled')
    assertExists(body.invitation.responded_at)
    assertEquals(body.message, 'Invitation cancelled successfully')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test('cancel-invitation: error handling', async (t) => {
  await t.step('returns 500 when update fails', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationWithLeague, error: null },
          update: { data: null, error: { message: 'Database error' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleCancelInvitation(req)

    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(body.error, 'Failed to cancel invitation')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
