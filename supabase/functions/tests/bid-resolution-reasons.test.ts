/** Reasons persist through cancellations and stay clear while a bid is pending. */
import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, invokeFunction, uniqueName } from './_setup.ts'

interface PlacedBid {
  bid: { id: string; resolution_reason: string | null }
}

Deno.test({
  name: 'bid resolution reason lifecycle',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const { client, secondClient, factory } = await createTestFactory()
    const service = getServiceClient()

    try {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-reasons'), 3)
      const thirdClient = await factory.createThirdClient()
      const { error: settingsError } = await service.from('leagues')
        .update({ new_bid_cutoff_hours: 0, bidding_counterpick_slots: 1 }).eq('id', leagueId)
      assertEquals(settingsError, null)
      const opponentPicks = await factory.getDraftPicksForUser(leagueId, thirdClient)
      assertExists(opponentPicks[0])

      for (const kind of ['pickup', 'counterpick'] as const) {
        await t.step(`${kind}: cancellation, restoration, and a new bid preserve reasons`, async () => {
          const table = kind === 'pickup' ? 'pickup_bids' : 'counterpick_bids'
          const place = kind === 'pickup' ? 'place-bid' : 'place-counterpick-bid'
          const cancel = kind === 'pickup' ? 'cancel-bid' : 'cancel-counterpick-bid'
          const payload = kind === 'pickup'
            ? {
              league_id: leagueId,
              tmdb_id: 987_623_001,
              movie_data: {
                title: 'Bid reason lifecycle',
                release_date: `${new Date().getFullYear()}-12-31`,
                poster_url: null,
              },
            }
            : { league_id: leagueId, movie_id: opponentPicks[0].movie_id }

          const first = await invokeFunction<PlacedBid>(client, place, { ...payload, amount: 5 })
          assertEquals(first.error, null)
          assertExists(first.data?.bid)
          assertEquals(first.data.bid.resolution_reason, null)
          const firstBidId = first.data.bid.id

          const second = await invokeFunction<PlacedBid>(secondClient, place, { ...payload, amount: 10 })
          assertEquals(second.error, null)
          assertExists(second.data?.bid)
          const secondBidId = second.data.bid.id

          // Keep cancellation independent of the wall-clock processing boundary.
          const { error: deadlineError } = await service.from(table)
            .update({ processing_deadline: new Date(Date.now() + 7 * 86400_000).toISOString() })
            .in('id', [firstBidId, secondBidId])
          assertEquals(deadlineError, null)

          const cancelled = await invokeFunction(secondClient, cancel, { bid_id: secondBidId })
          assertEquals(cancelled.error, null)
          const { data: rows, error: rowsError } = await service.from(table)
            .select('id, status, resolution_reason').in('id', [firstBidId, secondBidId])
          assertEquals(rowsError, null)
          assertEquals(rows?.find((row) => row.id === secondBidId), {
            id: secondBidId, status: 'cancelled', resolution_reason: 'user_cancelled',
          })
          assertEquals(rows?.find((row) => row.id === firstBidId), {
            id: firstBidId, status: 'active', resolution_reason: null,
          })

          // Rebidding after cancelling creates a separate row; its terminal
          // predecessor keeps the reason while the new contest stays pending.
          const replacement = await invokeFunction<PlacedBid>(secondClient, place, { ...payload, amount: 15 })
          assertEquals(replacement.error, null)
          assertExists(replacement.data?.bid)
          assertEquals(replacement.data.bid.resolution_reason, null)
          const raised = await invokeFunction<PlacedBid>(client, place, { ...payload, amount: 20 })
          assertEquals(raised.error, null)
          assertEquals(raised.data?.bid.id, firstBidId)
          assertEquals(raised.data?.bid.resolution_reason, null)
          const { data: historical, error: historicalError } = await service.from(table)
            .select('status, resolution_reason').eq('id', secondBidId).single()
          assertEquals(historicalError, null)
          assertEquals(historical, { status: 'cancelled', resolution_reason: 'user_cancelled' })
        })
      }
    } finally {
      await factory.cleanup()
    }
  },
})
