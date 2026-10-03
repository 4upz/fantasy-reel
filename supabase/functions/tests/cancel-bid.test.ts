/**
 * Integration tests for cancel-bid Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, getServiceClient, uniqueName, invokeFunction, invokePlaceBid } from './_setup.ts'
import { cancelClosedMessage, computeBidWindow, CANCEL_IN_PROCESSING_MESSAGE } from '../_shared/bid-window.ts'

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
      const { data: bidData } = await invokePlaceBid(client, {
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

    await t.step('cancels an outbid offer without promoting another bidder or resetting windows', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-outbid'), 3)
      const thirdClient = await factory.createThirdClient()
      const service = getServiceClient()
      const placedIds: string[] = []
      for (const [bidder, amount] of [[client, 10], [secondClient, 20], [thirdClient, 30]] as const) {
        const result = await invokeFunction<{ bid: { id: string } }>(bidder, 'place-bid', {
          league_id: leagueId,
          tmdb_id: 400002,
          amount,
          movie_data: { ...testMovieData, title: 'Outbid Cancel Movie' },
        })
        assertEquals(result.error, null)
        assertExists(result.data?.bid.id)
        placedIds.push(result.data.bid.id)
      }
      const { error: deadlineError } = await service.from('pickup_bids')
        .update({ processing_deadline: new Date(Date.now() + 7 * 86400_000).toISOString() })
        .in('id', placedIds)
      assertEquals(deadlineError, null)

      const remainingFields = 'id, status, resolution_reason, countered_at, response_deadline'
      const { data: before, error: beforeError } = await service.from('pickup_bids')
        .select(remainingFields).in('id', placedIds.slice(1)).order('id')
      assertEquals(beforeError, null)
      assertEquals(before?.filter((row) => row.status === 'active').length, 1)
      assertEquals(before?.filter((row) => row.status === 'outbid').length, 1)
      const { count: notificationCount, error: countError } = await service.from('notifications')
        .select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
      assertEquals(countError, null)

      const result = await invokeFunction<{ restored_bid: null }>(client, 'cancel-bid', {
        bid_id: placedIds[0],
      })
      assertEquals(result.error, null)
      assertEquals(result.data?.restored_bid, null)
      const { data: cancelled, error: cancelledError } = await service.from('pickup_bids')
        .select('status, resolution_reason').eq('id', placedIds[0]).single()
      assertEquals(cancelledError, null)
      assertEquals(cancelled, { status: 'cancelled', resolution_reason: 'user_cancelled' })
      const { data: after, error: afterError } = await service.from('pickup_bids')
        .select(remainingFields).in('id', placedIds.slice(1)).order('id')
      assertEquals(afterError, null)
      assertEquals(after, before)
      const { count: afterCount, error: afterCountError } = await service.from('notifications')
        .select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
      assertEquals(afterCountError, null)
      assertEquals(afterCount, notificationCount)
    })

    await t.step('outbid offers keep the same cutoff and processing deadline locks', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-outbid-locked'))
      const service = getServiceClient()
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)
      const { data: bid, error: bidError } = await service.from('pickup_bids').insert({
        league_id: leagueId,
        team_id: team.teamId,
        tmdb_id: 400006,
        movie_data: testMovieData,
        amount: 10,
        status: 'outbid',
        processing_deadline: new Date(Date.now() + 86400_000).toISOString(),
      }).select('id, processing_deadline').single()
      assertEquals(bidError, null)
      assertExists(bid)

      const { error: cutoffError } = await service.from('leagues')
        .update({ new_bid_cutoff_hours: 48 }).eq('id', leagueId)
      assertEquals(cutoffError, null)
      const locked = await invokeFunction(client, 'cancel-bid', { bid_id: bid.id })
      assertEquals(locked.status, 400)
      assertEquals(locked.error, cancelClosedMessage(computeBidWindow(bid.processing_deadline, 48)))

      const { error: disableError } = await service.from('leagues')
        .update({ new_bid_cutoff_hours: 0 }).eq('id', leagueId)
      assertEquals(disableError, null)
      const { error: deadlineError } = await service.from('pickup_bids')
        .update({ processing_deadline: new Date(Date.now() - 3600_000).toISOString() }).eq('id', bid.id)
      assertEquals(deadlineError, null)
      const processing = await invokeFunction(client, 'cancel-bid', { bid_id: bid.id })
      assertEquals(processing.status, 400)
      assertEquals(processing.error, CANCEL_IN_PROCESSING_MESSAGE)
      const { data: unchanged, error: unchangedError } = await service.from('pickup_bids')
        .select('status, resolution_reason').eq('id', bid.id).single()
      assertEquals(unchangedError, null)
      assertEquals(unchanged, { status: 'outbid', resolution_reason: null })

      for (const status of ['won', 'lost', 'cancelled']) {
        const { error: statusError } = await service.from('pickup_bids').update({ status }).eq('id', bid.id)
        assertEquals(statusError, null)
        const settled = await invokeFunction(client, 'cancel-bid', { bid_id: bid.id })
        assertEquals(settled.status, 400)
        assertEquals(settled.error, 'Can only cancel pending bids')
      }
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully cancels active bid', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-success'))

      // Place a bid
      const { data: bidData } = await invokePlaceBid(client, {
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
      await invokePlaceBid(client, {
        body: {
          league_id: leagueId,
          tmdb_id: 400004,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Restore Bid Movie' },
        },
      })

      // Second user outbids with $20. The real client always resupplies movie_data.
      const { data: secondBidData } = await invokePlaceBid(secondClient, {
        body: {
          league_id: leagueId,
          tmdb_id: 400004,
          amount: 20,
          movie_data: { ...testMovieData, title: 'Restore Bid Movie' },
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
      await invokePlaceBid(client, {
        body: {
          league_id: leagueId,
          tmdb_id: 400005,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Multi Restore Movie' },
        },
      })

      // Second user bids $20. The real client always resupplies movie_data.
      await invokePlaceBid(secondClient, {
        body: {
          league_id: leagueId,
          tmdb_id: 400005,
          amount: 20,
          movie_data: { ...testMovieData, title: 'Multi Restore Movie' },
        },
      })

      // Third user bids $30
      const { data: thirdBidData } = await invokePlaceBid(thirdClient, {
        body: {
          league_id: leagueId,
          tmdb_id: 400005,
          amount: 30,
          movie_data: { ...testMovieData, title: 'Multi Restore Movie' },
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
