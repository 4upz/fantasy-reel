import { assertEquals } from '@std/assert'
import { sendDiscordNotification, DISCORD_COLORS } from './discord.ts'

// ============================================================================
// Mock Setup
// ============================================================================

const originalFetch = globalThis.fetch
const originalEnvGet = Deno.env.get

interface FetchCall {
  url: string
  body: Record<string, unknown>
}

let fetchCalls: FetchCall[] = []
let mockFetchResponse: Response = new Response(null, { status: 204 })
let mockFetchShouldThrow = false

function mockFetch() {
  fetchCalls = []
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (mockFetchShouldThrow) throw new Error('Network error')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = init?.body ? JSON.parse(init.body as string) : {}
    fetchCalls.push({ url, body })
    return mockFetchResponse
  }
}

function restoreFetch() {
  globalThis.fetch = originalFetch
  mockFetchShouldThrow = false
  mockFetchResponse = new Response(null, { status: 204 })
}

// Minimal mock Supabase client
interface MockQueryResult {
  data: unknown[] | Record<string, unknown> | null
  error: null | { message: string }
}

interface MockUpdateTracker {
  calls: Array<{ table: string; data: Record<string, unknown>; filter: Record<string, unknown> }>
}

function createMockSupabase(
  channelsData: unknown[] | null,
  channelsError: null | { message: string } = null
) {
  const updateTracker: MockUpdateTracker = { calls: [] }

  const client = {
    from: (table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _val: unknown) => ({
          eq: (_col2: string, _val2: unknown) => ({
            data: channelsData,
            error: channelsError,
            single: () => {
              const match = (channelsData as Record<string, unknown>[])?.find(
                (c) => true
              )
              return Promise.resolve({
                data: match ?? null,
                error: channelsError,
              } as MockQueryResult)
            },
          }),
          single: () => {
            const match = (channelsData as Record<string, unknown>[])?.find(
              (c) => true
            )
            return Promise.resolve({
              data: match ?? null,
              error: channelsError,
            } as MockQueryResult)
          },
        }),
      }),
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          updateTracker.calls.push({ table, data, filter: { [col]: val } })
          return Promise.resolve({ error: null })
        },
      }),
    }),
    _updateTracker: updateTracker,
  }

  return client as unknown as ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('sendDiscordNotification - sends to channels with matching category', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test', color: DISCORD_COLORS.gold }],
    })

    assertEquals(fetchCalls.length, 1)
    assertEquals(fetchCalls[0].url, 'https://discord.com/api/webhooks/1/token1')
    assertEquals(fetchCalls[0].body.username, 'Fantasy Reel')
    assertEquals((fetchCalls[0].body.embeds as Array<{ title: string }>)[0].title, 'Test')
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - filters by category preference', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: false,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'bids',
      embeds: [{ title: 'Bid', color: DISCORD_COLORS.gold }],
    })

    // Should not send -- bids disabled for this channel
    assertEquals(fetchCalls.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - prepends role mention when mentionRole is true', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: '123456789',
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'bids',
      content: 'Check this out',
      mentionRole: true,
    })

    assertEquals(fetchCalls.length, 1)
    assertEquals(fetchCalls[0].body.content, '<@&123456789> Check this out')
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - skips role mention when bid_alert_role_id is null', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'bids',
      content: 'Test',
      mentionRole: true,
    })

    assertEquals(fetchCalls.length, 1)
    assertEquals(fetchCalls[0].body.content, 'Test')
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - tracks failures on webhook error', async () => {
  mockFetchResponse = new Response('Not Found', { status: 404 })
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/bad',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 2,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    // Webhook should have been called
    assertEquals(fetchCalls.length, 1)

    // Failure tracking should have been called
    const tracker = (supabase as unknown as { _updateTracker: MockUpdateTracker })._updateTracker
    assertEquals(tracker.calls.length, 1)
    assertEquals(tracker.calls[0].table, 'discord_channels')
    assertEquals(tracker.calls[0].data.consecutive_failures, 3)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - resets failures on success', async () => {
  mockFetchResponse = new Response(null, { status: 204 })
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/good',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 5,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    const tracker = (supabase as unknown as { _updateTracker: MockUpdateTracker })._updateTracker
    assertEquals(tracker.calls.length, 1)
    assertEquals(tracker.calls[0].data.consecutive_failures, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - sends to multiple channels per league', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
      {
        id: 'ch-2',
        webhook_url: 'https://discord.com/api/webhooks/2/token2',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    assertEquals(fetchCalls.length, 2)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - never throws on catastrophic failure', async () => {
  mockFetchShouldThrow = true
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
      },
    ]
    const supabase = createMockSupabase(channels)

    // Should not throw
    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - never throws on fetch error in channels query', async () => {
  mockFetch()
  try {
    const supabase = createMockSupabase(null, { message: 'DB connection failed' })

    // Should not throw
    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    // No webhook calls made
    assertEquals(fetchCalls.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - handles empty channels list', async () => {
  mockFetch()
  try {
    const supabase = createMockSupabase([])

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    assertEquals(fetchCalls.length, 0)
  } finally {
    restoreFetch()
  }
})
