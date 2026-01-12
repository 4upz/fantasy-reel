/**
 * Unit tests for search-users Edge Function
 */

import { assertEquals } from '@std/assert'
import {
  createMockAuthRequest,
  mockEnvVars,
} from '../_test_utils/mocks.ts'
import {
  mockUser,
  mockUser2,
  mockLeague,
  mockInvitation,
  mockParticipant,
  validUUID,
} from '../_test_utils/fixtures.ts'

// Mock profile data
interface MockProfile {
  user_id: string
  display_name: string
  avatar_url: string | null
}

const mockProfile1: MockProfile = {
  user_id: 'p1111111-1111-1111-1111-111111111111',
  display_name: 'John Doe',
  avatar_url: null,
}

const mockProfile2: MockProfile = {
  user_id: 'p2222222-2222-2222-2222-222222222222',
  display_name: 'Jane Doe',
  avatar_url: 'https://example.com/avatar.jpg',
}

const mockProfile3: MockProfile = {
  user_id: mockUser2.id, // Already a participant
  display_name: 'Participant User',
  avatar_url: null,
}

// Mock auth users for email lookup
const mockAuthUsers = {
  users: [
    { id: mockProfile1.user_id, email: 'john.doe@example.com' },
    { id: mockProfile2.user_id, email: 'jane.doe@example.com' },
    { id: mockProfile3.user_id, email: mockUser2.email },
  ],
}

// Test state
let mockSupabaseConfig: {
  user: typeof mockUser | null
  league: typeof mockLeague | null
  participants: typeof mockParticipant[]
  pendingInvites: typeof mockInvitation[]
  profiles: MockProfile[]
  authUsers: typeof mockAuthUsers
  profileError?: { message: string } | null
}

/**
 * Mock handler that simulates the search-users Edge Function logic
 */
async function handleSearchUsers(req: Request): Promise<Response> {
  const {
    jsonResponse,
    errorResponse,
    handleCorsPreflightRequest,
    isValidUUID,
  } = await import('../_shared/utils.ts')

  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Auth check
    if (!mockSupabaseConfig.user) {
      return errorResponse('Unauthorized', 401)
    }

    const { query, league_id, limit = 10 } = await req.json()

    // Validation
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!query || query.trim().length < 2) {
      return errorResponse('Search query must be at least 2 characters', 400)
    }

    const searchQuery = query.trim().toLowerCase()
    const resultLimit = Math.min(Math.max(1, limit), 20)

    // League check
    if (!mockSupabaseConfig.league) {
      return errorResponse('League not found', 404)
    }

    if (mockSupabaseConfig.league.owner_id !== mockSupabaseConfig.user.id) {
      return errorResponse('Only the league owner can search for users to invite', 403)
    }

    // Profile error simulation
    if (mockSupabaseConfig.profileError) {
      console.error('Error searching profiles:', mockSupabaseConfig.profileError)
      return errorResponse('Failed to search users', 500)
    }

    // Get IDs to exclude
    const participantUserIds = mockSupabaseConfig.participants.map(p => p.user_id)
    const excludeIds = [mockSupabaseConfig.user.id, ...participantUserIds]

    // Get pending invite emails
    const pendingInviteEmails = mockSupabaseConfig.pendingInvites
      .filter(i => i.status === 'pending')
      .map(i => i.email.toLowerCase())

    // Filter profiles by search query and exclusions
    const matchingProfiles = mockSupabaseConfig.profiles.filter(p => {
      if (!p.display_name) return false
      if (!p.display_name.toLowerCase().includes(searchQuery)) return false
      if (excludeIds.includes(p.user_id)) return false
      return true
    })

    // Build email map
    const userEmailMap = new Map<string, string>()
    mockSupabaseConfig.authUsers.users.forEach(u => {
      userEmailMap.set(u.id, u.email)
    })

    // Build results, excluding pending invitees
    interface UserSearchResult {
      user_id: string
      display_name: string
      email_hint: string
      avatar_url: string | null
    }
    const results: UserSearchResult[] = []

    for (const profile of matchingProfiles) {
      if (results.length >= resultLimit) break

      const email = userEmailMap.get(profile.user_id)
      if (!email) continue

      // Exclude users with pending invitations
      if (pendingInviteEmails.includes(email.toLowerCase())) continue

      // Truncate email for hint
      const [local, domain] = email.split('@')
      const truncatedLocal = local.length > 1 ? local[0] + '***' : local + '***'
      const emailHint = `${truncatedLocal}@${domain}`

      results.push({
        user_id: profile.user_id,
        display_name: profile.display_name || 'Unknown User',
        email_hint: emailHint,
        avatar_url: profile.avatar_url,
      })
    }

    return jsonResponse({ users: results })

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

Deno.test('search-users: authentication', async (t) => {
  await t.step('returns 401 when unauthorized', async () => {
    mockSupabaseConfig = {
      user: null,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'john',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(body.error, 'Unauthorized')
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test('search-users: validation', async (t) => {
  await t.step('returns 400 when league_id invalid', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'john',
      league_id: 'invalid-uuid',
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Valid league_id is required')
  })

  await t.step('returns 400 when query too short', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'j',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(body.error, 'Search query must be at least 2 characters')
  })

  await t.step('returns 400 when query missing', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 400)
  })
})

// ============================================================================
// Authorization Tests
// ============================================================================

Deno.test('search-users: authorization', async (t) => {
  await t.step('returns 404 when league not found', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: null,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'john',
      league_id: validUUID,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 404)
    const body = await response.json()
    assertEquals(body.error, 'League not found')
  })

  await t.step('returns 403 when not league owner', async () => {
    const otherUserLeague = { ...mockLeague, owner_id: mockUser2.id }
    mockSupabaseConfig = {
      user: mockUser,
      league: otherUserLeague,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'john',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 403)
    const body = await response.json()
    assertEquals(body.error, 'Only the league owner can search for users to invite')
  })
})

// ============================================================================
// Search Results Tests
// ============================================================================

Deno.test('search-users: search results', async (t) => {
  await t.step('returns matching users by display_name', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [mockProfile1, mockProfile2],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'doe',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.users.length, 2)
    assertEquals(body.users[0].display_name, 'John Doe')
    assertEquals(body.users[1].display_name, 'Jane Doe')
  })

  await t.step('returns empty array when no matches', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [mockProfile1, mockProfile2],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'xyz',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.users.length, 0)
  })

  await t.step('excludes current user from results', async () => {
    const userProfile = {
      user_id: mockUser.id,
      display_name: 'Current User Doe',
      avatar_url: null,
    }
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [mockProfile1, userProfile],
      authUsers: {
        users: [
          ...mockAuthUsers.users,
          { id: mockUser.id, email: mockUser.email },
        ],
      },
    }

    const req = createMockAuthRequest({
      query: 'doe',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    // Should only have mockProfile1, not the current user
    assertEquals(body.users.length, 1)
    assertEquals(body.users[0].display_name, 'John Doe')
  })

  await t.step('excludes existing participants from results', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [{ ...mockParticipant, user_id: mockProfile1.user_id }],
      pendingInvites: [],
      profiles: [mockProfile1, mockProfile2],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'doe',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    // Should only have mockProfile2, mockProfile1 is a participant
    assertEquals(body.users.length, 1)
    assertEquals(body.users[0].display_name, 'Jane Doe')
  })

  await t.step('excludes users with pending invitations', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [{ ...mockInvitation, email: 'john.doe@example.com', status: 'pending' }],
      profiles: [mockProfile1, mockProfile2],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'doe',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    // Should only have mockProfile2, mockProfile1 has pending invite
    assertEquals(body.users.length, 1)
    assertEquals(body.users[0].display_name, 'Jane Doe')
  })

  await t.step('truncates email for privacy in email_hint', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [mockProfile1],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'john',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.users.length, 1)
    assertEquals(body.users[0].email_hint, 'j***@example.com')
  })

  await t.step('respects limit parameter', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [mockProfile1, mockProfile2],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'doe',
      league_id: mockLeague.id,
      limit: 1,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.users.length, 1)
  })

  await t.step('includes avatar_url in results', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [mockProfile2],
      authUsers: mockAuthUsers,
    }

    const req = createMockAuthRequest({
      query: 'jane',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.users.length, 1)
    assertEquals(body.users[0].avatar_url, 'https://example.com/avatar.jpg')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test('search-users: error handling', async (t) => {
  await t.step('returns 500 when profile search fails', async () => {
    mockSupabaseConfig = {
      user: mockUser,
      league: mockLeague,
      participants: [],
      pendingInvites: [],
      profiles: [],
      authUsers: mockAuthUsers,
      profileError: { message: 'Database error' },
    }

    const req = createMockAuthRequest({
      query: 'john',
      league_id: mockLeague.id,
    })
    const response = await handleSearchUsers(req)

    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(body.error, 'Failed to search users')
  })
})

// Cleanup
Deno.test('cleanup', () => {
  cleanupEnv()
})
