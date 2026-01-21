/**
 * Integration tests for cancel-bid Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

// Test movie data for bidding
const currentYear = new Date().getFullYear()
const testMovieData = {
  title: 'Test Cancel Bid Movie',
  overview: 'A test movie for cancel bid testing',
  poster_url: '/test-poster.jpg',
  release_date: `${currentYear}-12-15`,
  vote_average: 0,
  popularity: 100,
  genre_ids: [28, 12],
}

Deno.test({
  name: 'cancel-bid',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'cancel-bid', {
        bid_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing bid_id', async () => {
      const result = await invokeFunction(client, 'cancel-bid', {})
      assertEquals(result.error, 'Valid bid_id is required')
    })

    await t.step('returns 400 for invalid bid_id', async () => {
      const result = await invokeFunction(client, 'cancel-bid', {
        bid_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid bid_id is required')
    })

    // ============================================================================
    // Not Found Tests
    // ============================================================================

    await t.step('returns 404 when bid does not exist', async () => {
      const result = await invokeFunction(client, 'cancel-bid', {
        bid_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Bid not found')
    })

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when trying to cancel another team bid', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-not-owner'))

      // First user places a bid
      const { data: bidData } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400001,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Not Owner Cancel Movie' },
        },
      })

      // Second user tries to cancel first user's bid
      const result = await invokeFunction(secondClient, 'cancel-bid', {
        bid_id: bidData.bid.id,
      })
      assertEquals(result.error, 'You can only cancel your own bids')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when bid status is not active (outbid)', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-outbid'))

      // First user places a bid
      const { data: bidData } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400002,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Outbid Cancel Movie' },
        },
      })

      // Second user outbids
      await secondClient.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400002,
          amount: 20,
        },
      })

      // First user tries to cancel their outbid bid
      const result = await invokeFunction(client, 'cancel-bid', {
        bid_id: bidData.bid.id,
      })
      assertEquals(result.error, 'Can only cancel active bids')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully cancels active bid', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-success'))

      // Place a bid
      const { data: bidData } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400003,
          amount: 15,
          movie_data: { ...testMovieData, title: 'Cancel Success Movie' },
        },
      })

      // Cancel the bid
      const { data, error } = await client.functions.invoke('cancel-bid', {
        body: { bid_id: bidData.bid.id },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Bid cancelled successfully')
      assertEquals(data.restored_bid, null) // No other bids to restore
    })

    await t.step('restores next highest bidder when highest bid is cancelled', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-restore'))

      // First user places bid of $10
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400004,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Restore Bid Movie' },
        },
      })

      // Second user outbids with $20
      const { data: secondBidData } = await secondClient.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400004,
          amount: 20,
        },
      })

      // Second user cancels their winning bid
      const { data, error } = await secondClient.functions.invoke('cancel-bid', {
        body: { bid_id: secondBidData.bid.id },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Bid cancelled successfully')
      assertExists(data.restored_bid)
      assertEquals(data.restored_bid.amount, 10) // First user's bid is restored
    })

    await t.step('restores highest among multiple outbid bidders', async () => {
      // Create league with 3 participants from the start
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-multi'), 3)

      // Get the third client (already in the league from createActiveLeague)
      const thirdClient = await factory.createThirdClient()

      // First user bids $10
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400005,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Multi Restore Movie' },
        },
      })

      // Second user bids $20
      await secondClient.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400005,
          amount: 20,
        },
      })

      // Third user bids $30
      const { data: thirdBidData } = await thirdClient.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 400005,
          amount: 30,
        },
      })

      // Third user cancels - should restore second user (highest outbid)
      const { data, error } = await thirdClient.functions.invoke('cancel-bid', {
        body: { bid_id: thirdBidData.bid.id },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Bid cancelled successfully')
      assertExists(data.restored_bid)
      assertEquals(data.restored_bid.amount, 20) // Second user's $20 bid restored
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
