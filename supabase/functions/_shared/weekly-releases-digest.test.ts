/**
 * Unit tests for weekly-releases-digest Edge Function logic.
 *
 * Drives runWeeklyReleasesDigest() directly with a mock Supabase client
 * (see _mock-client.ts) and mocked global fetch (for the real
 * sendDiscordNotification webhook call -- exercised as-is, not duplicated).
 * No running Supabase or Edge Function runtime required.
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { runWeeklyReleasesDigest, weekBounds } from '../weekly-releases-digest/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const LEAGUE_ID = 'league-1'
const MOVIE_ID = 'movie-1'

// A date guaranteed to fall inside the current Monday-Sunday window.
const { start: THIS_WEEK_MONDAY } = weekBounds(new Date())

function baseDb(): MockDb {
  return {
    movies: [{ id: MOVIE_ID, title: 'Fight Club', release_date: THIS_WEEK_MONDAY }],
    draft_picks: [
      { movie_id: MOVIE_ID, league_id: LEAGUE_ID, dropped_at: null, teams: { name: 'Team A' } },
    ],
    pickups: [],
    discord_channels: [
      {
        id: 'ch-1',
        league_id: LEAGUE_ID,
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        thread_id: null,
        bid_alert_role_id: null,
        enabled: true,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        notify_weekly_digest: true,
        notify_movie_news: true,
        consecutive_failures: 0,
      },
    ],
    leagues: [{ id: LEAGUE_ID, name: 'The League' }],
  }
}

Deno.test('weekly-releases-digest', async (t) => {
  await t.step('weekBounds returns a Monday-Sunday span containing the given date', () => {
    const { start, end } = weekBounds(new Date('2026-08-05T12:00:00Z')) // a Wednesday
    assertEquals(start, '2026-08-03') // Monday
    assertEquals(end, '2026-08-09') // Sunday
  })

  await t.step('no-op when nothing releases this week', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.movies[0].release_date = '2000-01-01'
      const client = createMockDbClient(db)

      const result = await runWeeklyReleasesDigest(client)

      assertEquals(result.leagues_notified, 0)
      assertEquals(result.movies_included, 0)
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('sends a digest for a league with a release this week', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db)

      const result = await runWeeklyReleasesDigest(client)

      assertEquals(result.leagues_notified, 1)
      assertEquals(result.movies_included, 1)
      assertEquals(calls.length, 1)
    } finally {
      restore()
    }
  })

  await t.step('skips leagues with no rostered releases this week (no message, not an error)', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.draft_picks = []
      const client = createMockDbClient(db)

      const result = await runWeeklyReleasesDigest(client)

      assertEquals(result.leagues_notified, 0)
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('skips dropped roster slots', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.draft_picks[0].dropped_at = new Date().toISOString()
      const client = createMockDbClient(db)

      const result = await runWeeklyReleasesDigest(client)

      assertEquals(result.leagues_notified, 0)
    } finally {
      restore()
    }
  })

  await t.step('respects notify_weekly_digest per channel', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.discord_channels[0].notify_weekly_digest = false
      const client = createMockDbClient(db)

      const result = await runWeeklyReleasesDigest(client)

      assertEquals(result.leagues_notified, 1) // function still "notified" (attempted)
      assertEquals(calls.length, 0) // but the channel filtered it out
    } finally {
      restore()
    }
  })

  await t.step('rerunning does not error and reports consistent results (no idempotency guard by design)', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db)

      const first = await runWeeklyReleasesDigest(client)
      const second = await runWeeklyReleasesDigest(client)

      assertEquals(first, second)
      assertEquals(calls.length, 2)
    } finally {
      restore()
    }
  })
})
