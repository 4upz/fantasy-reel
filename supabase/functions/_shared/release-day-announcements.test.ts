/**
 * Unit tests for release-day-announcements Edge Function logic.
 *
 * Drives runReleaseDayAnnouncements() directly with a mock Supabase client
 * (see _mock-client.ts) and mocked global fetch (for the real
 * sendDiscordNotification webhook call -- exercised as-is, not duplicated).
 * No running Supabase or Edge Function runtime required.
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { runReleaseDayAnnouncements } from '../release-day-announcements/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const LEAGUE_ID = 'league-1'
const MOVIE_ID = 'movie-1'
const TODAY = new Date().toISOString().split('T')[0]

function baseDb(): MockDb {
  return {
    movies: [{ id: MOVIE_ID, title: 'Fight Club', poster_url: '/poster.jpg', release_date: TODAY }],
    draft_picks: [
      { movie_id: MOVIE_ID, league_id: LEAGUE_ID, dropped_at: null, teams: { name: 'Team A' } },
    ],
    pickups: [],
    discord_notification_log: [],
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

Deno.test('release-day-announcements', async (t) => {
  await t.step('no-op when nothing releases today', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.movies[0].release_date = '2000-01-01'
      const client = createMockDbClient(db)

      const result = await runReleaseDayAnnouncements(client)

      assertEquals(result, { leagues_notified: 0, movies_announced: 0 })
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('announces a rostered movie releasing today and logs it', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db)

      const result = await runReleaseDayAnnouncements(client)

      assertEquals(result, { leagues_notified: 1, movies_announced: 1 })
      assertEquals(calls.length, 1)
      assertEquals(db.discord_notification_log.length, 1)
      assertEquals(db.discord_notification_log[0].movie_id, MOVIE_ID)
      assertEquals(db.discord_notification_log[0].notification_type, 'release_day')
    } finally {
      restore()
    }
  })

  await t.step('ignores movies with no active roster holder', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.draft_picks = []
      const client = createMockDbClient(db)

      const result = await runReleaseDayAnnouncements(client)

      assertEquals(result, { leagues_notified: 0, movies_announced: 0 })
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

      const result = await runReleaseDayAnnouncements(client)

      assertEquals(result, { leagues_notified: 0, movies_announced: 0 })
    } finally {
      restore()
    }
  })

  await t.step('double-run protection: a second run does not re-announce', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      const client = createMockDbClient(db)

      const first = await runReleaseDayAnnouncements(client)
      assertEquals(first, { leagues_notified: 1, movies_announced: 1 })
      assertEquals(calls.length, 1)

      const second = await runReleaseDayAnnouncements(client)
      assertEquals(second, { leagues_notified: 0, movies_announced: 0 })
      // Still just the one webhook call from the first run
      assertEquals(calls.length, 1)
      // Log wasn't duplicated
      assertEquals(db.discord_notification_log.length, 1)
    } finally {
      restore()
    }
  })

  await t.step('picks up movies via pickups as well as draft_picks', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.draft_picks = []
      db.pickups = [
        { movie_id: MOVIE_ID, league_id: LEAGUE_ID, dropped_at: null, teams: { name: 'Team B' } },
      ]
      const client = createMockDbClient(db)

      const result = await runReleaseDayAnnouncements(client)

      assertEquals(result, { leagues_notified: 1, movies_announced: 1 })
      assertEquals(calls.length, 1)
    } finally {
      restore()
    }
  })

  await t.step('respects notify_movie_news per channel', async () => {
    const { calls, restore } = stubFetch()
    try {
      const db = baseDb()
      db.discord_channels[0].notify_movie_news = false
      const client = createMockDbClient(db)

      const result = await runReleaseDayAnnouncements(client)

      // Still "notified" from the function's point of view (it logged + attempted
      // dispatch); the channel itself just filters it out inside sendDiscordNotification.
      assertEquals(result.movies_announced, 1)
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })
})
