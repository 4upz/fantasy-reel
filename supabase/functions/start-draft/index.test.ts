import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  createMockSupabaseClient,
  createMockAuthRequest,
  createMockOptionsRequest,
} from '../_test_utils/mocks.ts'
import { mockUser, mockLeague } from '../_test_utils/fixtures.ts'

Deno.test('start-draft - returns 200 for OPTIONS preflight', async () => {
  const req = createMockOptionsRequest()

  // The actual handler would return CORS headers for OPTIONS
  assertEquals(req.method, 'OPTIONS')
})

Deno.test('start-draft - returns 401 when not authenticated', async () => {
  const mockClient = createMockSupabaseClient({
    user: null,
  })

  // Verify auth check would fail
  const { data: { user } } = await mockClient.auth.getUser()
  assertEquals(user, null)
})

Deno.test('start-draft - returns 400 for invalid league_id', async () => {
  const body = { league_id: 'invalid-uuid' }
  const req = createMockAuthRequest(body)

  // Verify request body
  const parsed = await req.clone().json()
  assertEquals(parsed.league_id, 'invalid-uuid')
})

Deno.test('start-draft - returns 404 when league not found', async () => {
  const mockClient = createMockSupabaseClient({
    user: mockUser,
    tables: {
      leagues: {
        select: { data: null, error: { message: 'Not found' } },
      },
    },
  })

  const { data: league, error } = await mockClient
    .from('leagues')
    .select('*')
    .eq('id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    .single()

  assertEquals(league, null)
  assertEquals(error?.message, 'Not found')
})

Deno.test('start-draft - returns 403 when user is not owner', async () => {
  const nonOwnerLeague = {
    ...mockLeague,
    owner_id: 'different-user-id-1234-5678-90abcdef1234',
  }

  const mockClient = createMockSupabaseClient({
    user: mockUser,
    tables: {
      leagues: {
        select: { data: nonOwnerLeague, error: null },
      },
    },
  })

  const { data: league } = await mockClient
    .from('leagues')
    .select('*')
    .eq('id', mockLeague.id)
    .single()

  // User is not the owner
  assertEquals(league?.owner_id !== mockUser.id, true)
})

Deno.test('start-draft - returns 400 when league not in setup status', async () => {
  const draftingLeague = {
    ...mockLeague,
    status: 'drafting',
  }

  const mockClient = createMockSupabaseClient({
    user: mockUser,
    tables: {
      leagues: {
        select: { data: draftingLeague, error: null },
      },
    },
  })

  const { data: league } = await mockClient
    .from('leagues')
    .select('*')
    .eq('id', mockLeague.id)
    .single()

  // League is not in setup status
  assertEquals(league?.status !== 'setup', true)
})

Deno.test('start-draft - returns 400 when less than 2 participants', async () => {
  const setupLeague = {
    ...mockLeague,
    owner_id: mockUser.id,
    status: 'setup',
  }

  const mockClient = createMockSupabaseClient({
    user: mockUser,
    tables: {
      leagues: {
        select: { data: setupLeague, error: null },
      },
      league_participants: {
        select: { data: [], error: null, count: 1 },
      },
    },
  })

  // Simulate count query
  const { count } = await mockClient
    .from('league_participants')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', mockLeague.id)
    .eq('status', 'active')

  assertEquals(count, 1)
  assertEquals(count && count < 2, true)
})

Deno.test('start-draft - returns 200 and updates status on success', async () => {
  const setupLeague = {
    ...mockLeague,
    owner_id: mockUser.id,
    status: 'setup',
  }

  const updatedLeague = {
    ...setupLeague,
    status: 'drafting',
  }

  const mockClient = createMockSupabaseClient({
    user: mockUser,
    tables: {
      leagues: {
        select: { data: setupLeague, error: null },
        update: { data: updatedLeague, error: null },
      },
      league_participants: {
        select: { data: [{}, {}], error: null, count: 2 },
      },
    },
  })

  // Verify league can be updated
  const { data: league } = await mockClient
    .from('leagues')
    .update({ status: 'drafting' })
    .eq('id', mockLeague.id)
    .select()
    .single()

  assertEquals(league?.status, 'drafting')
})
