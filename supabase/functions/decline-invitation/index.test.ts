/**
 * Unit tests for decline-invitation Edge Function
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
  mockInvitation,
  mockInvitationExpired,
  mockInvitationAccepted,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

// Create mock invitation for current user's email
const mockInvitationForUser = {
  ...mockInvitation,
  email: mockUser.email,
}

const mockInvitationExpiredForUser = {
  ...mockInvitationExpired,
  email: mockUser.email,
}

const mockInvitationAcceptedForUser = {
  ...mockInvitationAccepted,
  email: mockUser.email,
}

const mockDeclinedInvitation = {
  ...mockInvitationForUser,
  status: 'declined',
  responded_at: new Date().toISOString(),
}

async function handleDeclineInvitation(req: Request): Promise<Response> {
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

    // Fetch the invitation
    const { data: invitation, error: invitationError } = await mockClient
      .from('invitations')
      .select('*')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    // Verify the invitation is for the authenticated user's email
    if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
      return errorResponse('This invitation was not sent to you', 403)
    }

    // Check invitation status
    if (invitation.status !== 'pending') {
      return errorResponse(`Invitation has already been ${invitation.status}`, 400)
    }

    // Check if invitation is expired
    const expiresAt = new Date(invitation.expires_at)
    if (expiresAt < new Date()) {
      return errorResponse('Invitation has expired', 400)
    }

    // Update invitation status to declined
    const { data: updatedInvitation, error: updateError } = await mockClient
      .from('invitations')
      .update({
        status: 'declined',
        responded_at: new Date().toISOString(),
      })
      .eq('id', invitation_id)
      .select()
      .single()

    if (updateError) {
      return errorResponse('Failed to decline invitation', 500)
    }

    return jsonResponse({
      invitation: {
        id: updatedInvitation.id,
        league_id: updatedInvitation.league_id,
        email: updatedInvitation.email,
        status: updatedInvitation.status,
        responded_at: updatedInvitation.responded_at,
      },
      message: 'Invitation declined successfully',
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

Deno.test('decline-invitation: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: validUUID,
    })
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('decline-invitation: validation', async (t) => {
  await t.step('returns 400 when invitation_id missing', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleDeclineInvitation(req)

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
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid invitation_id is required')
  })
})

// ============================================================================
// Authorization Tests
// ============================================================================

Deno.test('decline-invitation: authorization', async (t) => {
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
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'Invitation not found')
  })

  await t.step('returns 403 when invitation email does not match user', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitation, error: null }, // email is invitee@example.com, not mockUser's email
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'This invitation was not sent to you')
  })
})

// ============================================================================
// Status Validation Tests
// ============================================================================

Deno.test('decline-invitation: status checks', async (t) => {
  await t.step('returns 400 when invitation already accepted', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationAcceptedForUser, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitationAcceptedForUser.id,
    })
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invitation has already been accepted')
  })

  await t.step('returns 400 when invitation expired', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationExpiredForUser, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitationExpiredForUser.id,
    })
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Invitation has expired')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('decline-invitation: success', async (t) => {
  await t.step('declines invitation and returns updated data', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationForUser, error: null },
          update: { data: mockDeclinedInvitation, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitationForUser.id,
    })
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertExists(body.invitation)
    assertEquals(body.invitation.status, 'declined')
    assertExists(body.invitation.responded_at)
    assertEquals(body.message, 'Invitation declined successfully')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test('decline-invitation: error handling', async (t) => {
  await t.step('returns 500 when update fails', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationForUser, error: null },
          update: { data: null, error: { message: 'Database error' } },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitationForUser.id,
    })
    const response = await handleDeclineInvitation(req)

    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(body.error, 'Failed to decline invitation')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
