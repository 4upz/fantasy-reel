import { assertEquals } from '@std/assert'
import { sendDiscordNotification, DISCORD_COLORS, isAllowedWebhookUrl, redactWebhookTokens } from './discord.ts'

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

interface MockRpcTracker {
  calls: Array<{ fn: string; params: Record<string, unknown> }>
}

function createMockSupabase(
  channelsData: unknown[] | null,
  channelsError: null | { message: string } = null,
  rpcResponse: { data: unknown; error: null | { message: string } } = { data: 1, error: null }
) {
  const updateTracker: MockUpdateTracker = { calls: [] }
  const rpcTracker: MockRpcTracker = { calls: [] }

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
    // Backs trackFailure()'s atomic increment (increment_discord_webhook_failure).
    rpc: (fn: string, params: Record<string, unknown>) => {
      rpcTracker.calls.push({ fn, params })
      return Promise.resolve(rpcResponse)
    },
    _updateTracker: updateTracker,
    _rpcTracker: rpcTracker,
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
        thread_id: null,
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
        thread_id: null,
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
        thread_id: null,
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
        thread_id: null,
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
        thread_id: null,
      },
    ]
    // increment_discord_webhook_failure does the +1 server-side (atomically);
    // the mock just returns what the DB would after incrementing 2 -> 3.
    const supabase = createMockSupabase(channels, null, { data: 3, error: null })

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    // Webhook should have been called
    assertEquals(fetchCalls.length, 1)

    // Failure tracking should have called the atomic-increment RPC
    const tracker = (supabase as unknown as { _rpcTracker: MockRpcTracker })._rpcTracker
    assertEquals(tracker.calls.length, 1)
    assertEquals(tracker.calls[0].fn, 'increment_discord_webhook_failure')
    assertEquals(tracker.calls[0].params.p_channel_id, 'ch-1')
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
        thread_id: null,
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
        thread_id: null,
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
        thread_id: null,
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
        thread_id: null,
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

Deno.test('sendDiscordNotification - appends thread_id as query parameter when present', async () => {
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
        thread_id: '1234567890',
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    assertEquals(fetchCalls.length, 1)
    assertEquals(
      fetchCalls[0].url,
      'https://discord.com/api/webhooks/1/token1?thread_id=1234567890'
    )
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - does not append thread_id when null', async () => {
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
        thread_id: null,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    assertEquals(fetchCalls.length, 1)
    // URL should be unchanged -- no query parameters
    assertEquals(fetchCalls[0].url, 'https://discord.com/api/webhooks/1/token1')
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - movie_news category filters by notify_movie_news', async () => {
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
        notify_weekly_digest: true,
        notify_movie_news: false,
        consecutive_failures: 0,
        thread_id: null,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'movie_news',
      embeds: [{ title: 'Releasing today' }],
    })

    // Should not send -- notify_movie_news disabled for this channel
    assertEquals(fetchCalls.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - weekly_digest category filters by notify_weekly_digest', async () => {
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
        notify_weekly_digest: true,
        notify_movie_news: true,
        consecutive_failures: 0,
        thread_id: null,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'weekly_digest',
      embeds: [{ title: 'This week' }],
    })

    assertEquals(fetchCalls.length, 1)
  } finally {
    restoreFetch()
  }
})

Deno.test('sendDiscordNotification - general category bypasses all per-channel toggles', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        bid_alert_role_id: null,
        notify_drafts: false,
        notify_bids: false,
        notify_trades: false,
        notify_scores: false,
        notify_weekly_digest: false,
        notify_movie_news: false,
        consecutive_failures: 0,
        thread_id: null,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'general',
      embeds: [{ title: 'New team joined' }],
    })

    // Every toggle is off, but 'general' has no gating column -- still sends
    assertEquals(fetchCalls.length, 1)
  } finally {
    restoreFetch()
  }
})

// ============================================================================
// Webhook URL allowlist and token redaction
// ============================================================================

function withSupabaseUrl<T>(url: string | undefined, fn: () => T): T {
  Deno.env.get = (key: string) => (key === 'SUPABASE_URL' ? url : originalEnvGet.call(Deno.env, key))
  try {
    return fn()
  } finally {
    Deno.env.get = originalEnvGet
  }
}

Deno.test('isAllowedWebhookUrl - accepts Discord webhook hosts and paths', () => {
  withSupabaseUrl('https://api.fantasyreel.com', () => {
    for (const url of [
      'https://discord.com/api/webhooks/123/abc-DEF_456',
      'https://discordapp.com/api/webhooks/123/abc',
      'https://canary.discord.com/api/webhooks/123/abc',
      'https://ptb.discord.com/api/webhooks/123/abc',
      'https://discord.com/api/v10/webhooks/123/abc',
    ]) {
      assertEquals(isAllowedWebhookUrl(url), true, url)
    }
  })
})

Deno.test('isAllowedWebhookUrl - refuses everything else in production', () => {
  withSupabaseUrl('https://api.fantasyreel.com', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'https://example.com/api/webhooks/1/token',
      'http://discord.com/api/webhooks/1/token',
      'https://discord.com.evil.example/api/webhooks/1/token',
      'https://evil.example/?https://discord.com/api/webhooks/1/token',
      'https://discord.com@evil.example/api/webhooks/1/token',
      'https://discord.com:8443/api/webhooks/1/token',
      'https://discord.com/api/users/@me',
      'https://cdn.discordapp.com/api/webhooks/1/token',
      'http://127.0.0.1:54321/webhook',
      'http://host.docker.internal:9000/webhook',
      'not a url',
    ]) {
      assertEquals(isAllowedWebhookUrl(url), false, url)
    }
  })
})

Deno.test('isAllowedWebhookUrl - allows the test mock server only on a local stack', () => {
  for (const supabaseUrl of ['http://kong:8000', 'http://127.0.0.1:54321', 'http://localhost:54321']) {
    withSupabaseUrl(supabaseUrl, () => {
      assertEquals(isAllowedWebhookUrl('http://host.docker.internal:9000/webhook'), true, supabaseUrl)
      assertEquals(isAllowedWebhookUrl('http://127.0.0.1:9000/webhook'), true, supabaseUrl)
      assertEquals(isAllowedWebhookUrl('http://169.254.169.254/latest/meta-data'), false, supabaseUrl)
    })
  }
  withSupabaseUrl(undefined, () => {
    assertEquals(isAllowedWebhookUrl('http://127.0.0.1:9000/webhook'), false)
  })
})

Deno.test('sendDiscordNotification - refuses a non-Discord webhook URL without fetching', async () => {
  mockFetch()
  try {
    const channels = [
      {
        id: 'ch-ssrf',
        webhook_url: 'http://169.254.169.254/latest/meta-data',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
        thread_id: null,
      },
    ]
    const supabase = createMockSupabase(channels)

    await sendDiscordNotification(supabase, {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    assertEquals(fetchCalls.length, 0)
    // Counted as a failure, so the ops alert fires if the row stays broken.
    const tracker = (supabase as unknown as { _rpcTracker: MockRpcTracker })._rpcTracker
    assertEquals(tracker.calls.length, 1)
    assertEquals(tracker.calls[0].params.p_channel_id, 'ch-ssrf')
  } finally {
    restoreFetch()
  }
})

Deno.test('redactWebhookTokens - strips the webhook id and token', () => {
  assertEquals(
    redactWebhookTokens('error sending request for url (https://discord.com/api/webhooks/123/s3cr3t-token?thread_id=9): connection reset'),
    'error sending request for url (https://discord.com/api/webhooks/[redacted]): connection reset'
  )
  assertEquals(redactWebhookTokens('no url here'), 'no url here')
})

Deno.test('sendDiscordNotification - network error logs never contain the webhook token', async () => {
  globalThis.fetch = (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return Promise.reject(new TypeError(`error sending request for url (${url}): connection reset`))
  }
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn
  const lines: string[] = []
  console.error = (line: string) => lines.push(line)
  console.warn = (line: string) => lines.push(line)
  try {
    const channels = [
      {
        id: 'ch-1',
        webhook_url: 'https://discord.com/api/webhooks/123/s3cr3t-token',
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        consecutive_failures: 0,
        thread_id: null,
      },
    ]

    await sendDiscordNotification(createMockSupabase(channels), {
      leagueId: 'league-1',
      category: 'drafts',
      embeds: [{ title: 'Test' }],
    })

    const networkError = lines.find((line) => line.includes('Discord webhook network error'))
    assertEquals(networkError !== undefined, true)
    assertEquals(lines.some((line) => line.includes('s3cr3t-token')), false)
  } finally {
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
    restoreFetch()
  }
})
