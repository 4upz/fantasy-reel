/**
 * Unit tests for resend-invitation Edge Function
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
  mockInvitationExpired,
  mockInvitationAccepted,
  validUUID,
} from '../_test_utils/fixtures.ts'

let mockSupabaseConfig: MockSupabaseConfig = {}
let mockClient: ReturnType<typeof createMockSupabaseClient>

// Create invitation with league joined
const mockInvitationWithLeague = {
  ...mockInvitation,
  leagues: mockLeague,
}

const mockInvitationExpiredWithLeague = {
  ...mockInvitationExpired,
  leagues: mockLeague,
}

const mockInvitationAcceptedWithLeague = {
  ...mockInvitationAccepted,
  leagues: mockLeague,
}

const mockInvitationDeclinedWithLeague = {
  ...mockInvitation,
  status: 'declined',
  leagues: mockLeague,
}

const mockInvitationWithDraftingLeague = {
  ...mockInvitation,
  leagues: mockLeagueDrafting,
}

const mockInvitationWithOtherOwner = {
  ...mockInvitation,
  leagues: { ...mockLeague, owner_id: mockUser2.id },
}

// Updated invitation after resend
const mockResentInvitation = {
  ...mockInvitation,
  token: 'new-token-uuid-1234-5678-abcdef123456',
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'pending',
  sent_at: new Date().toISOString(),
  responded_at: null,
}

async function handleResendInvitation(req: Request): Promise<Response> {
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

    // Fetch the invitation with league info
    const { data: invitation, error: invitationError } = await mockClient
      .from('invitations')
      .select('*, leagues(*)')
      .eq('id', invitation_id)
      .single()

    if (invitationError || !invitation) {
      return errorResponse('Invitation not found', 404)
    }

    const league = invitation.leagues

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can resend invitations', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot resend invitations - draft has already started', 400)
    }

    // Check invitation status
    if (invitation.status === 'accepted') {
      return errorResponse('Cannot resend - invitation has already been accepted', 400)
    }
    if (invitation.status === 'declined') {
      return errorResponse('Cannot resend - invitation was declined', 400)
    }

    // Generate new token and expiration
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Update invitation
    const { data: updatedInvitation, error: updateError } = await mockClient
      .from('invitations')
      .update({
        token: crypto.randomUUID(),
        expires_at: newExpiresAt,
        status: 'pending',
        sent_at: new Date().toISOString(),
        responded_at: null,
      })
      .eq('id', invitation_id)
      .select()
      .single()

    if (updateError) {
      return errorResponse('Failed to resend invitation', 500)
    }

    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:3000'
    const inviteUrl = `${siteUrl}/join?token=${updatedInvitation.token}`

    return jsonResponse({
      invitation: {
        id: updatedInvitation.id,
        league_id: updatedInvitation.league_id,
        email: updatedInvitation.email,
        token: updatedInvitation.token,
        status: updatedInvitation.status,
        expires_at: updatedInvitation.expires_at,
      },
      invite_url: inviteUrl,
      message: `Invitation resent to ${updatedInvitation.email}`,
    })
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

Deno.test('resend-invitation: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = { user: null }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: validUUID,
    })
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 401)
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('resend-invitation: validation', async (t) => {
  await t.step('returns 400 when invitation_id missing', async () => {
    mockSupabaseConfig = { user: mockUser }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({})
    const response = await handleResendInvitation(req)

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
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid invitation_id is required')
  })
})

// ============================================================================
// Authorization Tests
// ============================================================================

Deno.test('resend-invitation: authorization', async (t) => {
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
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'Invitation not found')
  })

  await t.step('returns 403 when user is not league owner', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationWithOtherOwner, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'Only the league owner can resend invitations')
  })
})

// ============================================================================
// Status Validation Tests
// ============================================================================

Deno.test('resend-invitation: status checks', async (t) => {
  await t.step('returns 400 when draft already started', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationWithDraftingLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Cannot resend invitations - draft has already started')
  })

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
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Cannot resend - invitation has already been accepted')
  })

  await t.step('returns 400 when invitation was declined', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationDeclinedWithLeague, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Cannot resend - invitation was declined')
  })
})

// ============================================================================
// Success Tests
// ============================================================================

Deno.test('resend-invitation: success', async (t) => {
  await t.step('resends pending invitation with new token', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationWithLeague, error: null },
          update: { data: mockResentInvitation, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitation.id,
    })
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertExists(body.invitation)
    assertExists(body.invite_url)
    assertEquals(body.invitation.status, 'pending')
    assertEquals(body.invite_url.includes('/join?token='), true)
    assertExists(body.message)
  })

  await t.step('resends expired invitation with new token', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      tables: {
        invitations: {
          select: { data: mockInvitationExpiredWithLeague, error: null },
          update: { data: mockResentInvitation, error: null },
        },
      },
    }
    mockClient = createMockSupabaseClient(mockSupabaseConfig)

    const req = createMockAuthRequest({
      invitation_id: mockInvitationExpired.id,
    })
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertExists(body.invitation)
    assertEquals(body.invitation.status, 'pending')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test('resend-invitation: error handling', async (t) => {
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
    const response = await handleResendInvitation(req)

    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(body.error, 'Failed to resend invitation')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
