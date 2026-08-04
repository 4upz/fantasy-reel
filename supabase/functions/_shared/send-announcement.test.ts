/**
 * Unit tests for send-announcement Edge Function logic.
 *
 * Drives runSendAnnouncement() directly with mock Supabase clients (see
 * _mock-client.ts) and a mocked global fetch for the real
 * sendDiscordNotification webhook call. No running Supabase or Edge
 * Function runtime required.
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { runSendAnnouncement, MAX_MESSAGE_LENGTH } from '../send-announcement/handler.ts'
import { createMockDbClient, type MockDb } from './_mock-client.ts'

const originalFetch = globalThis.fetch

interface FetchCall {
  url: string
}

let fetchCalls: FetchCall[] = []

function mockFetch() {
  fetchCalls = []
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    fetchCalls.push({ url })
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

const LEAGUE_ID = 'league-1'
const OWNER_ID = 'user-owner'
const MEMBER_ID = 'user-member'

function baseDb(): MockDb {
  return {
    leagues: [{ id: LEAGUE_ID, name: 'The League', owner_id: OWNER_ID }],
    discord_channels: [
      {
        id: 'ch-1',
        league_id: LEAGUE_ID,
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        thread_id: null,
        bid_alert_role_id: null,
        enabled: true,
        notify_drafts: false,
        notify_bids: false,
        notify_trades: false,
        notify_scores: false,
        notify_weekly_digest: false,
        notify_movie_news: false,
        consecutive_failures: 0,
      },
    ],
  }
}

Deno.test('send-announcement', async (t) => {
  await t.step('400 when league_id is missing', async () => {
    const db = baseDb()
    const client = createMockDbClient(db)

    const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
      message: 'Hello',
    })

    assertEquals(status, 400)
    assertEquals('error' in result && result.error, 'Valid league_id is required')
  })

  await t.step('400 when league_id is not a valid UUID', async () => {
    const db = baseDb()
    const client = createMockDbClient(db)

    const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
      league_id: 'not-a-uuid',
      message: 'Hello',
    })

    assertEquals(status, 400)
    assertEquals('error' in result && result.error, 'Valid league_id is required')
  })

  const VALID_LEAGUE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  await t.step('400 when message is empty', async () => {
    const db = baseDb()
    db.leagues[0].id = VALID_LEAGUE_ID
    const client = createMockDbClient(db)

    const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
      league_id: VALID_LEAGUE_ID,
      message: '   ',
    })

    assertEquals(status, 400)
    assertEquals('error' in result && result.error, 'Announcement message cannot be empty')
  })

  await t.step('400 when message exceeds the max length', async () => {
    const db = baseDb()
    db.leagues[0].id = VALID_LEAGUE_ID
    const client = createMockDbClient(db)

    const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
      league_id: VALID_LEAGUE_ID,
      message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1),
    })

    assertEquals(status, 400)
    assertEquals('error' in result && result.error, `Announcement cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
  })

  await t.step('404 when league does not exist', async () => {
    const db = baseDb()
    const client = createMockDbClient(db)

    const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
      league_id: '00000000-0000-0000-0000-000000000000',
      message: 'Hello',
    })

    assertEquals(status, 404)
    assertEquals('error' in result && result.error, 'League not found')
  })

  await t.step('403 when caller is not the league owner', async () => {
    mockFetch()
    try {
      const db = baseDb()
      db.leagues[0].id = VALID_LEAGUE_ID
      const client = createMockDbClient(db)

      const { status, result } = await runSendAnnouncement(client, client, MEMBER_ID, {
        league_id: VALID_LEAGUE_ID,
        message: 'Trade deadline is Friday',
      })

      assertEquals(status, 403)
      assertEquals('error' in result && result.error, 'Only the league owner can post announcements')
      assertEquals(fetchCalls.length, 0)
    } finally {
      restoreFetch()
    }
  })

  await t.step('200: posts to every enabled channel regardless of category toggles', async () => {
    mockFetch()
    try {
      const db = baseDb()
      db.leagues[0].id = VALID_LEAGUE_ID
      db.discord_channels[0].league_id = VALID_LEAGUE_ID
      const client = createMockDbClient(db)

      const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
        league_id: VALID_LEAGUE_ID,
        message: 'Draft trade deadline is Friday.',
      })

      assertEquals(status, 200)
      assertEquals('error' in result, false)
      if (!('error' in result)) {
        assertEquals(result.channels_notified, 1)
      }
      // Every notify_* toggle is false in the fixture, but 'general' bypasses them
      assertEquals(fetchCalls.length, 1)
    } finally {
      restoreFetch()
    }
  })

  await t.step('200 with channels_notified: 0 when no Discord channels are linked', async () => {
    mockFetch()
    try {
      const db = baseDb()
      db.leagues[0].id = VALID_LEAGUE_ID
      db.discord_channels = []
      const client = createMockDbClient(db)

      const { status, result } = await runSendAnnouncement(client, client, OWNER_ID, {
        league_id: VALID_LEAGUE_ID,
        message: 'Hello league',
      })

      assertEquals(status, 200)
      if (!('error' in result)) {
        assertEquals(result.channels_notified, 0)
      }
      assertEquals(fetchCalls.length, 0)
    } finally {
      restoreFetch()
    }
  })
})
