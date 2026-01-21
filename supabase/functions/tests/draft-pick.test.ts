/**
 * Integration tests for draft-pick Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

// Test movie data for upcoming releases
const currentYear = new Date().getFullYear()
const testMovieData = {
  title: 'Test Upcoming Movie',
  overview: 'A test movie for draft testing',
  poster_url: '/test-poster.jpg',
  backdrop_url: '/test-backdrop.jpg',
  release_date: `${currentYear}-12-15`,
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

  await t.step('returns 400 when movie not found and no movie_data provided', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-no-movie-data'))

    const result = await invokeFunction(client, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: 99999999,
    })
    assertEquals(result.error, 'Movie not found and no movie_data provided')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('creates draft pick successfully', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-success'))

    const { data, error } = await client.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: 100001,
        movie_data: { ...testMovieData, title: 'Draft Success Movie' },
      },
    })

    assertEquals(error, null)
    assertExists(data.pick)
    assertExists(data.movie)
    assertEquals(data.pick.league_id, leagueId)
    assertEquals(data.pick.round, 1)
    assertEquals(data.pick.pick_number, 1)
    assertEquals(data.movie.tmdb_id, 100001)
    assertEquals(data.movie.title, 'Draft Success Movie')
    assertExists(data.next_pick)
    assertEquals(data.draft_complete, false)
  })

  await t.step('allows second user to pick after first user', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('draft-second-pick'))

    // First user picks
    await client.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: 100002,
        movie_data: { ...testMovieData, title: 'First Pick Movie' },
      },
    })

    // Second user picks
    const { data, error } = await secondClient.functions.invoke('draft-pick', {
      body: {
        league_id: leagueId,
        tmdb_id: 100003,
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
        tmdb_id: 100004,
        movie_data: { ...testMovieData, title: 'Already Drafted Movie' },
      },
    })

    // Second user tries to pick same movie
    const result = await invokeFunction(secondClient, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: 100004,
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
        tmdb_id: 100005,
        movie_data: { ...testMovieData, title: 'Reusable Movie' },
      },
    })

    // Create another league to test movie reuse
    const leagueId2 = await factory.createDraftingLeague(uniqueName('draft-reuse-movie'))

    // Pick same tmdb_id in different league (movie already exists in DB)
    const { data, error } = await client.functions.invoke('draft-pick', {
      body: { league_id: leagueId2, tmdb_id: 100005 },
    })

    assertEquals(error, null)
    assertExists(data.movie)
    assertEquals(data.movie.tmdb_id, 100005)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
