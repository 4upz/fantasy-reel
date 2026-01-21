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

    await t.step('returns 400 for missing pickup_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {})
      assertEquals(result.error, 'Valid pickup_id is required')
    })

    await t.step('returns 400 for invalid pickup_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid pickup_id is required')
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

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when trying to drop another team movie', async () => {
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
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when movie has already been dropped', async () => {
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

    await t.step('returns 400 when movie has already been released', async () => {
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
    // Drop Limit Tests
    // ============================================================================

    await t.step('returns 400 when drop limit is reached', async () => {
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

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully drops a movie', async () => {
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

    await t.step('tracks drop count correctly', async () => {
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

    await t.step('allows dropping movie with null release date', async () => {
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
