/** Pending counterpick offers remain cancellable only before their own cutoff. */
import { assertEquals, assertExists } from '@std/assert'
import { cancelClosedMessage, computeBidWindow, CANCEL_IN_PROCESSING_MESSAGE } from '../_shared/bid-window.ts'
import { createTestFactory, getServiceClient, invokeFunction, uniqueName } from './_setup.ts'

Deno.test({
  name: 'cancel-counterpick-bid: pending offers and cancellation locks',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const { client, secondClient, factory } = await createTestFactory()
    const service = getServiceClient()
    try {
      const leagueId = await factory.createActiveLeague(uniqueName('cancel-cp-pending'), 3)
      const thirdClient = await factory.createThirdClient()
      const targetTeam = await factory.getTeamForUser(leagueId, thirdClient)
      assertExists(targetTeam)
      const targets = await factory.getDraftPicksForUser(leagueId, thirdClient)
      assertExists(targets[1])
      const { error: settingsError } = await service.from('leagues')
        .update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)
      assertEquals(settingsError, null)

      const placeContest = async (movieId: string): Promise<string[]> => {
        const ids: string[] = []
        for (const [bidder, amount] of [[client, 10], [secondClient, 20]] as const) {
          const result = await invokeFunction<{ bid: { id: string } }>(bidder, 'place-counterpick-bid', {
            league_id: leagueId, movie_id: movieId, amount,
          })
          assertEquals(result.error, null)
          assertExists(result.data?.bid.id)
          ids.push(result.data.bid.id)
        }
        const { error } = await service.from('counterpick_bids')
          .update({ processing_deadline: new Date(Date.now() + 7 * 86400_000).toISOString() })
          .in('id', ids)
        assertEquals(error, null)
        return ids
      }

      await t.step('cancels an outbid offer without changing the leader or sending a restoration notice', async () => {
        const [outbidId, leaderId] = await placeContest(targets[0].movie_id)
        const fields = 'id, status, resolution_reason, countered_at, response_deadline'
        const { data: leaderBefore, error: beforeError } = await service.from('counterpick_bids')
          .select(fields).eq('id', leaderId).single()
        assertEquals(beforeError, null)
        assertEquals(leaderBefore?.status, 'active')
        const { count: notificationCount, error: countError } = await service.from('notifications')
          .select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
        assertEquals(countError, null)

        const result = await invokeFunction<{ restored_bid: null }>(client, 'cancel-counterpick-bid', { bid_id: outbidId })
        assertEquals(result.error, null)
        assertEquals(result.data?.restored_bid, null)
        const { data: cancelled, error: cancelledError } = await service.from('counterpick_bids')
          .select('status, resolution_reason').eq('id', outbidId).single()
        assertEquals(cancelledError, null)
        assertEquals(cancelled, { status: 'cancelled', resolution_reason: 'user_cancelled' })
        const { data: leaderAfter, error: afterError } = await service.from('counterpick_bids')
          .select(fields).eq('id', leaderId).single()
        assertEquals(afterError, null)
        assertEquals(leaderAfter, leaderBefore)
        const { count: afterCount, error: afterCountError } = await service.from('notifications')
          .select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
        assertEquals(afterCountError, null)
        assertEquals(afterCount, notificationCount)
      })

      await t.step('still restores the runner-up when the active leader cancels', async () => {
        const [outbidId, leaderId] = await placeContest(targets[1].movie_id)
        const result = await invokeFunction<{ restored_bid: { id: string; amount: number } }>(
          secondClient, 'cancel-counterpick-bid', { bid_id: leaderId },
        )
        assertEquals(result.error, null)
        assertEquals(result.data?.restored_bid, { id: outbidId, amount: 10 })
        const { data: restored, error: restoredError } = await service.from('counterpick_bids')
          .select('status, resolution_reason, countered_at, response_deadline').eq('id', outbidId).single()
        assertEquals(restoredError, null)
        assertEquals(restored, { status: 'active', resolution_reason: null, countered_at: null, response_deadline: null })
      })

      await t.step('outbid offers remain locked after cutoff or processing deadline, and settled offers cannot cancel', async () => {
        const team = await factory.getTeamForUser(leagueId, client)
        assertExists(team)
        const deadline = new Date(Date.now() + 86400_000).toISOString()
        const { data: bid, error: bidError } = await service.from('counterpick_bids').insert({
          league_id: leagueId,
          team_id: team.teamId,
          target_team_id: targetTeam.teamId,
          movie_id: targets[0].movie_id,
          draft_pick_id: targets[0].id,
          amount: 5,
          status: 'outbid',
          processing_deadline: deadline,
        }).select('id').single()
        assertEquals(bidError, null)
        assertExists(bid)
        const { error: cutoffError } = await service.from('leagues')
          .update({ new_bid_cutoff_hours: 48 }).eq('id', leagueId)
        assertEquals(cutoffError, null)
        const locked = await invokeFunction(client, 'cancel-counterpick-bid', { bid_id: bid.id })
        assertEquals(locked.status, 400)
        assertEquals(locked.error, cancelClosedMessage(computeBidWindow(deadline, 48)))

        const { error: disableError } = await service.from('leagues')
          .update({ new_bid_cutoff_hours: 0 }).eq('id', leagueId)
        assertEquals(disableError, null)
        const { error: deadlineError } = await service.from('counterpick_bids')
          .update({ processing_deadline: new Date(Date.now() - 3600_000).toISOString() }).eq('id', bid.id)
        assertEquals(deadlineError, null)
        const processing = await invokeFunction(client, 'cancel-counterpick-bid', { bid_id: bid.id })
        assertEquals(processing.status, 400)
        assertEquals(processing.error, CANCEL_IN_PROCESSING_MESSAGE)
        const { data: unchanged, error: unchangedError } = await service.from('counterpick_bids')
          .select('status, resolution_reason').eq('id', bid.id).single()
        assertEquals(unchangedError, null)
        assertEquals(unchanged, { status: 'outbid', resolution_reason: null })

        for (const status of ['won', 'lost', 'cancelled']) {
          const { error: statusError } = await service.from('counterpick_bids').update({ status }).eq('id', bid.id)
          assertEquals(statusError, null)
          const settled = await invokeFunction(client, 'cancel-counterpick-bid', { bid_id: bid.id })
          assertEquals(settled.status, 400)
          assertEquals(settled.error, 'Can only cancel pending bids')
        }
      })
    } finally {
      await factory.cleanup()
    }
  },
})
