/**
 * Integration tests for draft-pick Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, getServiceClient, uniqueName, invokeFunction } from './_setup.ts'

import { buildCacheKey } from '../_shared/tmdb-cache.ts'
import type { MovieDetailsResponse } from '../_shared/movie-details.ts'

// Test movie data for upcoming releases
const today = new Date().toISOString().slice(0, 10)
const testMovieData = {
  title: 'Test Upcoming Movie',
  overview: 'A test movie for draft testing',
  poster_url: '/test-poster.jpg',
  backdrop_url: '/test-backdrop.jpg',
  release_date: today,
  vote_average: 0,
  popularity: 100,
  genre_ids: [28, 12],
}

Deno.test({
  name: 'draft-pick',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()
  const service = getServiceClient()
  const baseId = 1_500_000_000 + Math.floor(Math.random() * 400_000_000)
  const fixtureIds = new Set<number>()

  async function cacheMovie(tmdbId: number, overrides: Partial<MovieDetailsResponse> = {}) {
    fixtureIds.add(tmdbId)
    const payload: MovieDetailsResponse = {
      tmdb_id: tmdbId, title: `Canonical Movie ${tmdbId}`, imdb_id: null, tagline: null,
      overview: 'Trusted synopsis', release_date: today, runtime: 120, status: 'Planned',
      poster_url: 'https://image.tmdb.org/t/p/w500/canonical.jpg', backdrop_url: null,
      vote_average: 0, vote_count: 0, genres: [], cast: [], director: null, ...overrides,
    }
    const { error } = await service.from('tmdb_cache').upsert({
      cache_key: buildCacheKey('movie_details', { tmdb_id: tmdbId }), payload,
      fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    assertEquals(error, null)
    return payload
  }

  async function storedMovie(tmdbId: number) {
    const { data, error } = await service.from('movies').select('*').eq('tmdb_id', tmdbId).maybeSingle()
    assertEquals(error, null)
    return data
  }

  try {
  // Trusted service-only fixtures exercise the real cache/Edge path without TMDb calls.
  for (const [offset, title] of [
    [1, 'Draft Success Movie'], [2, 'First Pick Movie'], [3, 'Second Pick Movie'],
    [4, 'Already Drafted Movie'], [5, 'Reusable Movie'],
  ] as const) await cacheMovie(baseId + offset, { title })
  await cacheMovie(baseId + 9, { tmdb_id: 123 })

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'draft-pick', {
      league_id: '00000000-0000-0000-0000-000000000000',
      tmdb_id: 12345,
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const result = await invokeFunction(client, 'draft-pick', { tmdb_id: 12345 })
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid league_id', async () => {
    const result = await invokeFunction(client, 'draft-pick', {
      league_id: 'not-a-uuid',
      tmdb_id: 12345,
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for missing tmdb_id', async () => {
    const result = await invokeFunction(client, 'draft-pick', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'Valid tmdb_id is required')
  })

  await t.step('returns 400 for invalid tmdb_id', async () => {
    const result = await invokeFunction(client, 'draft-pick', {
      league_id: '00000000-0000-0000-0000-000000000000',
      tmdb_id: 'not-a-number',
    })
    assertEquals(result.error, 'Valid tmdb_id is required')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const result = await invokeFunction(client, 'draft-pick', {
      league_id: '00000000-0000-0000-0000-000000000000',
      tmdb_id: 12345,
    })
    assertEquals(result.error, 'League not found')
  })

  // ============================================================================
  // Status Tests
  // ============================================================================

  await t.step('returns 400 when draft has not started', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('draft-not-started'))

    const result = await invokeFunction(client, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: 12345,
    })
    assertEquals(result.error, 'Draft has not started yet')
  })

  // ============================================================================
  // Turn Validation Tests
  // ============================================================================

  await t.step('returns 403 when it is not your turn', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-not-your-turn'))

    // Second user tries to pick first (but first user has draft_order 1)
    const result = await invokeFunction(secondClient, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: 99001,
      movie_data: { ...testMovieData, title: 'Not Your Turn Movie' },
    })
    assertEquals(result.error, 'It is not your turn to pick')
  })

  // ============================================================================
  // Movie Validation Tests
  // ============================================================================

  await t.step('rejects unverifiable movie identity without trusting client data', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-no-movie-data'))

    const result = await invokeFunction(client, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: baseId + 9,
    })
    assertEquals(result.status, 503)
    assertEquals(result.error, 'Movie details could not be verified. Please try again.')
    assertEquals(await storedMovie(baseId + 9), null)
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('creates draft pick successfully', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-success'))

    const { data, error } = await client.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: baseId + 1,
        movie_data: { ...testMovieData, title: 'Spoofed client title', release_date: '2099-12-31' },
      },
    })

    assertEquals(error, null)
    assertExists(data.pick)
    assertExists(data.movie)
    assertEquals(data.pick.league_id, leagueId)
    assertEquals(data.pick.round, 1)
    assertEquals(data.pick.pick_number, 1)
    assertEquals(data.movie.tmdb_id, baseId + 1)
    assertEquals(data.movie.title, 'Draft Success Movie')
    assertEquals(data.movie.release_date, today)
    assertEquals(data.movie.poster_url, 'https://image.tmdb.org/t/p/w500/canonical.jpg')
    assertExists(data.next_pick)
    assertEquals(data.draft_complete, false)
  })

  await t.step('allows second user to pick after first user', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-second-pick'))

    // First user picks
    await client.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: baseId + 2,
        movie_data: { ...testMovieData, title: 'First Pick Movie' },
      },
    })

    // Second user picks
    const { data, error } = await secondClient.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: baseId + 3,
        movie_data: { ...testMovieData, title: 'Second Pick Movie' },
      },
    })

    assertEquals(error, null)
    assertExists(data.pick)
    assertEquals(data.pick.pick_number, 2)
    assertEquals(data.movie.title, 'Second Pick Movie')
  })

  await t.step('returns 400 when movie already drafted', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-already-drafted'))

    // First user picks
    await client.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: baseId + 4,
        movie_data: { ...testMovieData, title: 'Already Drafted Movie' },
      },
    })

    // Second user tries to pick same movie
    const result = await invokeFunction(secondClient, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: baseId + 4,
      movie_data: testMovieData,
    })
    assertEquals(result.error, 'This movie has already been drafted')
  })

  await t.step('reuses existing movie record if already in database', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-existing-movie'))

    // First user picks and creates movie record
    await client.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: baseId + 5,
        movie_data: { ...testMovieData, title: 'Reusable Movie' },
      },
    })

    // Create another league to test movie reuse
    const leagueId2 = await factory.createDraftingLeague(uniqueName('draft-reuse-movie'))

    // Pick same tmdb_id in different league (movie already exists in DB)
    const { data, error } = await client.functions.invoke('draft-pick', {
      body: { league_id: leagueId2, tmdb_id: baseId + 5 },
    })

    assertEquals(error, null)
    assertExists(data.movie)
    assertEquals(data.movie.tmdb_id, baseId + 5)
  })


  await t.step('rejects fractional and out-of-range movie IDs before lookup', async () => {
    for (const tmdbId of [1.5, 2_147_483_648]) {
      const result = await invokeFunction(client, 'draft-pick', {
        league_id: '00000000-0000-0000-0000-000000000000', tmdb_id: tmdbId,
      })
      assertEquals(result.error, 'Valid tmdb_id is required')
    }
  })

  await t.step('rejects forged dates and malformed metadata without creating rows', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-forged-date'))
    await cacheMovie(baseId + 10, { release_date: '2000-01-01' })
    const past = await invokeFunction(client, 'draft-pick', {
      league_id: leagueId, tmdb_id: baseId + 10,
      movie_data: { ...testMovieData, release_date: '2099-12-31' },
    })
    assertEquals(past.error, 'This movie cannot be drafted: Movie was released in a previous season')
    assertEquals(await storedMovie(baseId + 10), null)
    await cacheMovie(baseId + 11, { release_date: '2099-02-30' })
    const malformed = await invokeFunction(client, 'draft-pick', { league_id: leagueId, tmdb_id: baseId + 11 })
    assertEquals(malformed.status, 503)
    assertEquals(await storedMovie(baseId + 11), null)
  })

  await t.step('unknown dates do not poison a corrected ID-only wishlist retry', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-corrected-retry'))
    await cacheMovie(baseId + 12, { release_date: null })
    const rejected = await invokeFunction(client, 'draft-pick', {
      league_id: leagueId, tmdb_id: baseId + 12, movie_data: testMovieData,
    })
    assertEquals(rejected.error, 'This movie cannot be drafted: Movie has no release date')
    assertEquals(await storedMovie(baseId + 12), null)
    await cacheMovie(baseId + 12)
    const { data, error } = await client.functions.invoke('draft-pick', {
      body: { league_id: leagueId, tmdb_id: baseId + 12 },
    })
    assertEquals(error, null)
    assertEquals(data.movie.release_date, today)
    assertExists(data.pick.id)
  })

  await t.step('repairs existing null metadata while preserving identity and scores', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-repair-metadata'))
    const details = await cacheMovie(baseId + 13)
    const { data: poisoned, error: insertError } = await service.from('movies').insert({
      tmdb_id: details.tmdb_id, title: 'Old incomplete movie', release_date: null,
      status: 'upcoming', combined_score: 82, fantasy_points: 30, popularity: 123,
    }).select('id').single()
    assertEquals(insertError, null)
    const { data, error } = await client.functions.invoke('draft-pick', {
      body: { league_id: leagueId, tmdb_id: details.tmdb_id },
    })
    assertEquals(error, null)
    assertEquals(data.movie.id, poisoned!.id)
    assertEquals(data.movie.release_date, today)
    const persisted = await storedMovie(details.tmdb_id)
    assertEquals(persisted.title, details.title)
    assertEquals(persisted.combined_score, 82)
    assertEquals(persisted.fantasy_points, 30)
    assertEquals(persisted.popularity, 123)
  })

  await t.step('ordinary users cannot forge trusted cache entries', async () => {
    const details = await cacheMovie(baseId + 14)
    const { error } = await client.from('tmdb_cache').upsert({
      cache_key: buildCacheKey('movie_details', { tmdb_id: details.tmdb_id }),
      payload: { ...details, title: 'Forged cache' }, expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    assertExists(error)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  } finally {
    await factory.cleanup()
    const { error: movieCleanupError } = await service.from('movies').delete().in('tmdb_id', [...fixtureIds])
    assertEquals(movieCleanupError, null)
    const { error: cacheCleanupError } = await service.from('tmdb_cache').delete().in('cache_key', [...fixtureIds].map(tmdb_id => buildCacheKey('movie_details', { tmdb_id })))
    assertEquals(cacheCleanupError, null)
  }
}})
