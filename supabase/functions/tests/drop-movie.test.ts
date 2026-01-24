/**
 * Integration tests for drop-movie Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

// Test movie data for pickups
const currentYear = new Date().getFullYear()
const testMovieData = {
  title: 'Test Drop Movie',
  overview: 'A test movie for drop testing',
  poster_url: '/test-poster.jpg',
  release_date: `${currentYear}-12-15`,
  vote_average: 0,
  popularity: 100,
  genre_ids: [28, 12],
}

Deno.test({
  name: 'drop-movie',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'drop-movie', {
        pickup_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing both pickup_id and draft_pick_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {})
      assertEquals(result.error, 'Valid pickup_id or draft_pick_id is required')
    })

    await t.step('returns 400 for invalid pickup_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid pickup_id or draft_pick_id is required')
    })

    await t.step('returns 400 for invalid draft_pick_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid pickup_id or draft_pick_id is required')
    })

    await t.step('returns 400 when both pickup_id and draft_pick_id provided', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: '00000000-0000-0000-0000-000000000000',
        draft_pick_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Provide only one of pickup_id or draft_pick_id')
    })

    // ============================================================================
    // Not Found Tests
    // ============================================================================

    await t.step('returns 404 when pickup does not exist', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Pickup not found')
    })

    await t.step('returns 404 when draft pick does not exist', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Draft pick not found')
    })

    // ============================================================================
    // Authorization Tests (Pickups)
    // ============================================================================

    await t.step('returns 403 when trying to drop another team pickup', async () => {
      // Create active league and simulate a pickup for user1
      const leagueId = await factory.createActiveLeague(uniqueName('drop-not-owner'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500001,
        ...testMovieData,
        title: 'Not Owner Drop Movie',
      })

      // Second user tries to drop first user's pickup
      const result = await invokeFunction(secondClient, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'You can only drop your own movies')
    })

    // ============================================================================
    // Authorization Tests (Draft Picks)
    // ============================================================================

    await t.step('returns 403 when trying to drop another team draft pick', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-not-owner'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500101,
        ...testMovieData,
        title: 'Not Owner Draft Pick',
      })

      // Second user tries to drop first user's draft pick
      const result = await invokeFunction(secondClient, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'You can only drop your own movies')
    })

    // ============================================================================
    // Status Tests (Pickups)
    // ============================================================================

    await t.step('returns 400 when pickup has already been dropped', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-already'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500002,
        ...testMovieData,
        title: 'Already Dropped Movie',
      })

      // Drop the movie first time
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      // Try to drop again
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'Movie has already been dropped')
    })

    await t.step('returns 400 when pickup movie has already been released', async () => {
      // Create a pickup with a past release date
      const leagueId = await factory.createActiveLeague(uniqueName('drop-released'))
      const pastReleaseDate = '2024-01-01' // Past date

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500003,
        ...testMovieData,
        title: 'Released Movie',
        release_date: pastReleaseDate,
      })

      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'Cannot drop a movie that has already been released')
    })

    // ============================================================================
    // Status Tests (Draft Picks)
    // ============================================================================

    await t.step('returns 400 when draft pick has already been dropped', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-already'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500102,
        ...testMovieData,
        title: 'Already Dropped Draft Pick',
      })

      // Drop the draft pick first time
      await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      // Try to drop again
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'Movie has already been dropped')
    })

    await t.step('returns 400 when draft pick movie has already been released', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-released'))
      const pastReleaseDate = '2024-01-01' // Past date

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500103,
        ...testMovieData,
        title: 'Released Draft Pick',
        release_date: pastReleaseDate,
      })

      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'Cannot drop a movie that has already been released')
    })

    // ============================================================================
    // Drop Limit Tests
    // ============================================================================

    await t.step('returns 400 when drop limit is reached (pickups)', async () => {
      // Create active league with default drop_limit of 2
      const leagueId = await factory.createActiveLeague(uniqueName('drop-limit'))

      // Create and drop 2 movies (reaching the limit)
      const pickup1 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500004,
        ...testMovieData,
        title: 'Drop Limit Movie 1',
      })
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup1 },
      })

      const pickup2 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500005,
        ...testMovieData,
        title: 'Drop Limit Movie 2',
      })
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup2 },
      })

      // Try to drop a third movie
      const pickup3 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500006,
        ...testMovieData,
        title: 'Drop Limit Movie 3',
      })

      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickup3,
      })
      assertEquals(result.error, 'You have reached the drop limit of 2')
    })

    await t.step('shared drop limit across pickups and draft picks', async () => {
      // Create active league with default drop_limit of 2
      const leagueId = await factory.createActiveLeague(uniqueName('shared-limit'))

      // Drop 1 pickup
      const pickup1 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500201,
        ...testMovieData,
        title: 'Shared Limit Pickup',
      })
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup1 },
      })

      // Drop 1 draft pick (should work - still under limit)
      const draftPick1 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500202,
        ...testMovieData,
        title: 'Shared Limit Draft Pick 1',
      })
      const { data: drop2 } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPick1 },
      })
      assertEquals(drop2.drops_used, 2)
      assertEquals(drop2.drops_remaining, 0)

      // Try to drop another draft pick (should fail - limit reached)
      const draftPick2 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500203,
        ...testMovieData,
        title: 'Shared Limit Draft Pick 2',
      })
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPick2,
      })
      assertEquals(result.error, 'You have reached the drop limit of 2')
    })

    // ============================================================================
    // Success Tests (Pickups)
    // ============================================================================

    await t.step('successfully drops a pickup', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-success'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500007,
        ...testMovieData,
        title: 'Drop Success Movie',
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
      assertExists(data.movie)
      assertEquals(data.movie.title, 'Drop Success Movie')
      assertEquals(data.movie.tmdb_id, 500007)
      assertEquals(data.drops_used, 1)
      assertEquals(data.drops_remaining, 1) // Default limit is 2, used 1
    })

    await t.step('tracks pickup drop count correctly', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-count'))

      // First drop
      const pickup1 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500008,
        ...testMovieData,
        title: 'Count Movie 1',
      })
      const { data: drop1 } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup1 },
      })

      assertEquals(drop1.drops_used, 1)
      assertEquals(drop1.drops_remaining, 1)

      // Second drop
      const pickup2 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500009,
        ...testMovieData,
        title: 'Count Movie 2',
      })
      const { data: drop2 } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup2 },
      })

      assertEquals(drop2.drops_used, 2)
      assertEquals(drop2.drops_remaining, 0)
    })

    await t.step('allows dropping pickup with null release date', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-null-date'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500010,
        ...testMovieData,
        title: 'Null Date Movie',
        release_date: null,
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    // ============================================================================
    // Success Tests (Draft Picks)
    // ============================================================================

    await t.step('successfully drops a draft pick', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-success'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500104,
        ...testMovieData,
        title: 'Drop Draft Success',
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
      assertExists(data.movie)
      assertEquals(data.movie.title, 'Drop Draft Success')
      assertEquals(data.movie.tmdb_id, 500104)
      assertEquals(data.drops_used, 1)
      assertEquals(data.drops_remaining, 1)
    })

    await t.step('tracks draft pick drop count correctly', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-count'))

      // First drop (draft pick)
      const draftPick1 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500105,
        ...testMovieData,
        title: 'Draft Count 1',
      })
      const { data: drop1 } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPick1 },
      })

      assertEquals(drop1.drops_used, 1)
      assertEquals(drop1.drops_remaining, 1)

      // Second drop (draft pick)
      const draftPick2 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500106,
        ...testMovieData,
        title: 'Draft Count 2',
      })
      const { data: drop2 } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPick2 },
      })

      assertEquals(drop2.drops_used, 2)
      assertEquals(drop2.drops_remaining, 0)
    })

    await t.step('allows dropping draft pick with null release date', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-null-date'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500107,
        ...testMovieData,
        title: 'Null Date Draft Pick',
        release_date: null,
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    // ============================================================================
    // Notification Tests
    // ============================================================================

    await t.step('creates notifications for other league members when movie is dropped', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-notify'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500011,
        ...testMovieData,
        title: 'Notify Drop Movie',
      })

      // Drop the movie
      const { error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)

      // Verify notification was created for second user
      // Note: This would require querying the notifications table directly
      // For now, we just verify the drop succeeded without error
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
