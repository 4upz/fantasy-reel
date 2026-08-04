/**
 * Unit tests for sync-release-dates Edge Function logic.
 *
 * Drives runSyncReleaseDates() directly with a mock Supabase client
 * (see _mock-client.ts) and a globally-mocked fetch covering both the TMDb
 * lookup and the real sendDiscordNotification webhook call. No running
 * Supabase or Edge Function runtime required.
 *
 * Run with: deno task test:unit
 */
import { assertEquals } from '@std/assert'
import { runSyncReleaseDates } from '../sync-release-dates/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const LEAGUE_ID = 'league-1'
const MOVIE_ID = 'movie-1'
const TMDB_ID = 550
const TMDB_TOKEN = 'test-tmdb-token'

const today = new Date().toISOString().split('T')[0]

function baseDb(): MockDb {
  return {
    movies: [
      { id: MOVIE_ID, tmdb_id: TMDB_ID, title: 'Fight Club', release_date: today },
    ],
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

/**
 * Answers TMDb movie lookups with `releaseDate`, or a 404 when it is null.
 * Everything else (the Discord webhook) falls through to stubFetch's 204.
 */
function tmdbResponder(releaseDate: string | null): (url: string) => Response | undefined {
  return (url) => {
    if (!url.includes('api.themoviedb.org')) return undefined
    if (releaseDate === null) return new Response('Not Found', { status: 404 })
    return new Response(JSON.stringify({ release_date: releaseDate }), { status: 200 })
  }
}

Deno.test('sync-release-dates', async (t) => {
  await t.step('no-op when no candidate movies', async () => {
    const db = baseDb()
    db.movies = []
    const client = createMockDbClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(today))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 0, dates_changed: 0, leagues_notified: 0 })
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('no-op when TMDb date matches stored date (no write, no send)', async () => {
    const db = baseDb()
    const client = createMockDbClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(today))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 0, leagues_notified: 0 })
      assertEquals(db.movies[0].release_date, today) // unchanged
      // Only the TMDb lookup happened, no Discord webhook call
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('updates the stored date and notifies when TMDb reports a change', async () => {
    const db = baseDb()
    const client = createMockDbClient(db)
    const newDate = '2027-01-15'
    const { calls, restore } = stubFetch(tmdbResponder(newDate))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 1, leagues_notified: 1 })
      assertEquals(db.movies[0].release_date, newDate)
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 1)
    } finally {
      restore()
    }
  })

  await t.step('ignores movies with no active roster holder', async () => {
    const db = baseDb()
    db.draft_picks = []
    const client = createMockDbClient(db)
    const { calls, restore } = stubFetch(tmdbResponder('2027-01-15'))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 0, dates_changed: 0, leagues_notified: 0 })
      // Never even reaches out to TMDb for a movie nobody rosters
      assertEquals(calls.filter((c) => c.url.includes('api.themoviedb.org')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('does not write or notify when the TMDb lookup fails', async () => {
    const db = baseDb()
    const client = createMockDbClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(null))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 0, leagues_notified: 0 })
      assertEquals(db.movies[0].release_date, today)
    } finally {
      restore()
    }
  })
})
