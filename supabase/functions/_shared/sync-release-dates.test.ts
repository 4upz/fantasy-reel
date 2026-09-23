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
import { assertEquals, assertRejects } from '@std/assert'
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
      { id: MOVIE_ID, tmdb_id: TMDB_ID, title: 'Fight Club', release_date: today, poster_url: null },
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
function tmdbResponder(releaseDate: string | null, posterPath: string | null = null): (url: string) => Response | undefined {
  return (url) => {
    if (!url.includes('api.themoviedb.org')) return undefined
    if (releaseDate === null) return new Response('Not Found', { status: 404 })
    return new Response(JSON.stringify({ id: TMDB_ID, title: 'Fight Club', release_date: releaseDate, poster_path: posterPath }), { status: 200 })
  }
}

/** Add pagination and fault injection locally without broadening the shared mock. */
function createSyncClient(db: MockDb, failure?: 'holdings' | 'movies' | 'update') {
  const client = createMockDbClient(db)
  const from = client.from.bind(client)
  const batches: string[][] = []
  const ranges: number[][] = []
  client.from = (table: string) => {
    const query = from(table)
    if (table === 'team_holdings') {
      const rows = query.select().data
      const page = {
        order: () => page,
        range: (start: number, end: number) => {
          ranges.push([start, end])
          return failure === 'holdings'
            ? { data: null, error: { message: 'holdings unavailable' } }
            : { data: rows.slice(start, end + 1), error: null }
        },
      }
      return { select: () => page }
    }
    if (table === 'movies') {
      const select = query.select.bind(query)
      query.select = () => ({
        in: (column: string, ids: string[]) => {
          batches.push(ids)
          return failure === 'movies'
            ? { gt: () => ({ data: null, error: { message: 'movies unavailable' } }) }
            : select().in(column, ids)
        },
      })
      if (failure === 'update') {
        query.update = () => ({ eq: () => ({ select: () => ({ single: () => ({ data: null, error: { message: 'write failed' } }) }) }) })
      }
    }
    return query
  }
  return { client, batches, ranges }
}

Deno.test('sync-release-dates', async (t) => {
  await t.step('no-op when no candidate movies', async () => {
    const db = baseDb()
    db.movies = []
    const { client } = createSyncClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(today))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 0, dates_changed: 0, posters_updated: 0, leagues_notified: 0, failed: 0 })
      assertEquals(calls.length, 0)
    } finally {
      restore()
    }
  })

  await t.step('no-op when TMDb date matches stored date (no write, no send)', async () => {
    const db = baseDb()
    const { client } = createSyncClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(today))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 0, posters_updated: 0, leagues_notified: 0, failed: 0 })
      assertEquals(db.movies[0].release_date, today) // unchanged
      // Only the TMDb lookup happened, no Discord webhook call
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('updates the stored date and notifies when TMDb reports a change', async () => {
    const db = baseDb()
    const { client } = createSyncClient(db)
    const newDate = '2027-01-15'
    const { calls, restore } = stubFetch(tmdbResponder(newDate))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 1, posters_updated: 0, leagues_notified: 1, failed: 0 })
      assertEquals(db.movies[0].release_date, newDate)
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 1)
    } finally {
      restore()
    }
  })

  await t.step('ignores movies with no active roster holder', async () => {
    const db = baseDb()
    db.draft_picks = []
    const { client } = createSyncClient(db)
    const { calls, restore } = stubFetch(tmdbResponder('2027-01-15'))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 0, dates_changed: 0, posters_updated: 0, leagues_notified: 0, failed: 0 })
      // Never even reaches out to TMDb for a movie nobody rosters
      assertEquals(calls.filter((c) => c.url.includes('api.themoviedb.org')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('does not write or notify when the TMDb lookup fails', async () => {
    const db = baseDb()
    db.movies[0].poster_url = 'https://image.tmdb.org/t/p/w500/existing.jpg'
    const { client } = createSyncClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(null))

    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 0, posters_updated: 0, leagues_notified: 0, failed: 1 })
      assertEquals(db.movies[0].release_date, today)
      assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/existing.jpg')
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 0)
    } finally {
      restore()
    }
  })

  for (const releaseDate of [today, '1999-10-15', null]) {
    await t.step(`repairs a missing poster independently of stored release date ${releaseDate}`, async () => {
      const db = baseDb()
      db.movies[0].release_date = releaseDate
      const { client } = createSyncClient(db)
      const { calls, restore } = stubFetch(tmdbResponder(today, '/new-poster.jpg'))
      try {
        const result = await runSyncReleaseDates(client, TMDB_TOKEN)
        assertEquals(result, { movies_checked: 1, dates_changed: 0, posters_updated: 1, leagues_notified: 0, failed: 0 })
        assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/new-poster.jpg')
        assertEquals(db.movies[0].release_date, releaseDate)
        assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 0)
      } finally {
        restore()
      }
    })
  }

  await t.step('replaces changed artwork and makes subsequent runs a no-op', async () => {
    const db = baseDb()
    db.movies[0].poster_url = 'https://image.tmdb.org/t/p/w500/old-poster.jpg'
    const { client } = createSyncClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(today, '/new-poster.jpg'))
    try {
      assertEquals((await runSyncReleaseDates(client, TMDB_TOKEN)).posters_updated, 1)
      assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/new-poster.jpg')
      assertEquals((await runSyncReleaseDates(client, TMDB_TOKEN)).posters_updated, 0)
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 0)
    } finally {
      restore()
    }
  })

  for (const posterUrl of ['/existing.jpg', 'https://image.tmdb.org/t/p/w342/existing.jpg']) {
    await t.step(`does not rewrite equivalent artwork ${posterUrl}`, async () => {
      const db = baseDb()
      db.movies[0].poster_url = posterUrl
      const { client } = createSyncClient(db)
      const { restore } = stubFetch(tmdbResponder(today, '/existing.jpg'))
      try {
        assertEquals((await runSyncReleaseDates(client, TMDB_TOKEN)).posters_updated, 0)
        assertEquals(db.movies[0].poster_url, posterUrl)
      } finally {
        restore()
      }
    })
  }

  for (const posterPath of [null, '', 'https://untrusted.test/image.jpg', '/invalid/path.jpg']) {
    await t.step(`preserves existing artwork for an absent or invalid poster path ${posterPath}`, async () => {
      const db = baseDb()
      db.movies[0].poster_url = 'https://image.tmdb.org/t/p/w500/existing.jpg'
      const { client } = createSyncClient(db)
      const { restore } = stubFetch(tmdbResponder(today, posterPath))
      try {
        assertEquals((await runSyncReleaseDates(client, TMDB_TOKEN)).posters_updated, 0)
        assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/existing.jpg')
      } finally {
        restore()
      }
    })
  }

  await t.step('refreshes artwork when TMDb has no release date', async () => {
    const db = baseDb()
    const { client } = createSyncClient(db)
    const { restore } = stubFetch(tmdbResponder('', '/new-poster.jpg'))
    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result.posters_updated, 1)
      assertEquals(result.dates_changed, 0)
      assertEquals(result.failed, 0)
      assertEquals(db.movies[0].release_date, today)
    } finally {
      restore()
    }
  })

  for (const metadata of [null, { poster_path: '/new-poster.jpg' }, { id: TMDB_ID + 1, title: 'Other movie', poster_path: '/new-poster.jpg' }]) {
    await t.step(`rejects malformed or mismatched TMDb metadata ${JSON.stringify(metadata)}`, async () => {
      const db = baseDb()
      db.movies[0].poster_url = 'https://image.tmdb.org/t/p/w500/existing.jpg'
      const { client } = createSyncClient(db)
      const { restore } = stubFetch(() => new Response(JSON.stringify(metadata), { status: 200 }))
      try {
        const result = await runSyncReleaseDates(client, TMDB_TOKEN)
        assertEquals(result.failed, 1)
        assertEquals(result.posters_updated, 0)
        assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/existing.jpg')
      } finally {
        restore()
      }
    })
  }

  await t.step('reports update failures without claiming a poster/date change or notifying', async () => {
    const db = baseDb()
    const { client } = createSyncClient(db, 'update')
    const { calls, restore } = stubFetch(tmdbResponder('2027-01-15', '/new-poster.jpg'))
    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 0, posters_updated: 0, leagues_notified: 0, failed: 1 })
      assertEquals(db.movies[0].poster_url, null)
      assertEquals(db.movies[0].release_date, today)
      assertEquals(calls.filter((c) => c.url.includes('discord.com')).length, 0)
    } finally {
      restore()
    }
  })

  await t.step('continues refreshing other movies after a lookup failure', async () => {
    const db = baseDb()
    db.movies.push({ id: 'movie-2', tmdb_id: TMDB_ID + 1, title: 'Other movie', release_date: null, poster_url: null })
    db.pickups.push({ movie_id: 'movie-2', league_id: LEAGUE_ID, dropped_at: null, teams: { name: 'Team A' } })
    const { client } = createSyncClient(db)
    const { restore } = stubFetch((url) => url.endsWith(`/${TMDB_ID}`)
      ? new Response('Not Found', { status: 404 })
      : new Response(JSON.stringify({ id: TMDB_ID + 1, title: 'Other movie', poster_path: '/new-poster.jpg' }), { status: 200 }))
    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 2, dates_changed: 0, posters_updated: 1, leagues_notified: 0, failed: 1 })
      assertEquals(db.movies[0].poster_url, null)
      assertEquals(db.movies[1].poster_url, 'https://image.tmdb.org/t/p/w500/new-poster.jpg')
    } finally {
      restore()
    }
  })

  await t.step('updates both fields once and notifies every league holding the movie', async () => {
    const db = baseDb()
    db.pickups.push({ movie_id: MOVIE_ID, league_id: 'league-2', dropped_at: null, teams: { name: 'Team B' } })
    const { client } = createSyncClient(db)
    const { restore } = stubFetch(tmdbResponder('2027-01-15', '/new-poster.jpg'))
    try {
      const result = await runSyncReleaseDates(client, TMDB_TOKEN)
      assertEquals(result, { movies_checked: 1, dates_changed: 1, posters_updated: 1, leagues_notified: 2, failed: 0 })
      assertEquals(db.movies[0].release_date, '2027-01-15')
      assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/new-poster.jpg')
    } finally {
      restore()
    }
  })

  await t.step('excludes dropped movies and invalid TMDb IDs', async () => {
    const db = baseDb()
    db.draft_picks[0].dropped_at = today
    db.movies.push({ id: 'invalid-tmdb', tmdb_id: 0, title: 'Local movie', release_date: today, poster_url: null })
    db.pickups.push({ movie_id: 'invalid-tmdb', league_id: LEAGUE_ID, dropped_at: null, teams: { name: 'Team A' } })
    const { client } = createSyncClient(db)
    const { calls, restore } = stubFetch(tmdbResponder(today, '/new-poster.jpg'))
    try {
      assertEquals((await runSyncReleaseDates(client, TMDB_TOKEN)).movies_checked, 0)
      assertEquals(calls.length, 0)
      assertEquals(db.movies[0].poster_url, null)
    } finally {
      restore()
    }
  })

  await t.step('pages holdings and restricts movie queries to bounded roster ID batches', async () => {
    const db = baseDb()
    db.team_holdings = Array.from({ length: 1001 }, (_, i) => ({ movie_id: `movie-${i}`, league_id: LEAGUE_ID, team_name: 'Team A' }))
    db.movies[0].id = 'movie-1000'
    const { client, batches, ranges } = createSyncClient(db)
    const { restore } = stubFetch(tmdbResponder(today, '/new-poster.jpg'))
    try {
      assertEquals((await runSyncReleaseDates(client, TMDB_TOKEN)).posters_updated, 1)
      assertEquals(ranges, [[0, 999], [1000, 1999]])
      assertEquals(batches.map((batch) => batch.length), [150, 150, 150, 150, 150, 150, 101])
      assertEquals(new Set(batches.flat()).size, 1001)
      assertEquals(db.movies[0].poster_url, 'https://image.tmdb.org/t/p/w500/new-poster.jpg')
    } finally {
      restore()
    }
  })

  for (const failure of ['holdings', 'movies'] as const) {
    await t.step(`fails the job when the ${failure} query fails`, async () => {
      const { client } = createSyncClient(baseDb(), failure)
      const { calls, restore } = stubFetch(tmdbResponder(today))
      try {
        await assertRejects(() => runSyncReleaseDates(client, TMDB_TOKEN), Error, `${failure} unavailable`)
        assertEquals(calls.length, 0)
      } finally {
        restore()
      }
    })
  }
})
