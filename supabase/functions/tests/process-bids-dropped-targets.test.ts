/**
 * Integration tests for counterpick target revalidation in process-bids
 * (drop / trade guardrail).
 *
 * A counterpick bid targets a specific holding row (a draft_picks or pickups
 * record), not just a movie. Bids can sit pending for up to a week, and in
 * that time the holder can drop the movie or trade it away -- including
 * trading it to the bidder itself. This suite exercises the revalidation pass
 * that catches that at processing time, see `revalidateCounterpickTargets` in
 * process-bids/index.ts and `resolveTargetRevalidation` in
 * _shared/counterpick-resolution.ts.
 *
 * Requires: npx supabase start
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  getServiceClient,
  createTestFactory,
  uniqueName,
  getUserId,
} from './_setup.ts'
import {
  createProcessBidsCaller,
  PAST_DEADLINE,
  seedCounterpickBid as seedCounterpickBidRow,
  teamForOrThrow,
} from './_counterpick_helpers.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A tmdb_id range untouched by any other suite's draft/pickup pool, so
 * inserting or looking up movies here never collides with parallel runs.
 */
function uniqueTmdbId(): number {
  return 960_000_000 + Math.floor(Math.random() * 1_000_000)
}

Deno.test({
  name: 'process-bids counterpick target revalidation (dropped / traded holdings)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const callProcessBids = await createProcessBidsCaller()

    /**
     * Seed a normal, unrelated pickup bid that will win cleanly. Mirrors
     * `seedDecoyPickupBid` in tests/process-bids.test.ts: process-bids' weekly
     * mode is documented there as short-circuiting before it reaches
     * counterpick_bids without at least one pending pickup bid in the league.
     */
    async function seedDecoyPickupBid(leagueId: string, teamId: string): Promise<void> {
      const tmdbId = uniqueTmdbId()
      await serviceClient.from('pickup_bids').insert({
        league_id: leagueId,
        team_id: teamId,
        tmdb_id: tmdbId,
        movie_data: { title: `Decoy Movie ${tmdbId}`, release_date: '2099-01-01', vote_average: 5, popularity: 10 },
        amount: 1,
        status: 'active',
        processing_deadline: PAST_DEADLINE,
      })
    }

    const teamFor = (leagueId: string, userClient: SupabaseClient) =>
      teamForOrThrow(factory, leagueId, userClient)

    const seedCounterpickBid = (params: Parameters<typeof seedCounterpickBidRow>[1]) =>
      seedCounterpickBidRow(serviceClient, params)

    async function bidStatus(bidId: string): Promise<string | undefined> {
      const { data } = await serviceClient
        .from('counterpick_bids')
        .select('status')
        .eq('id', bidId)
        .single()
      return data?.status
    }

    async function latestNotification(userId: string, leagueId: string) {
      const { data } = await serviceClient
        .from('notifications')
        .select('type, data, body')
        .eq('user_id', userId)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    }

    try {
      // Other suites leave active bids behind; they would be swept into our runs.
      await serviceClient.from('pickup_bids').update({ status: 'lost' }).eq('status', 'active')
      await serviceClient.from('counterpick_bids').update({ status: 'lost' }).eq('status', 'active')

      await t.step('cancels a counterpick bid whose target movie was dropped before processing', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cp-dropped'), 2)
        await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

        const bidderTeam = await teamFor(leagueId, client)
        const targetTeam = await teamFor(leagueId, secondClient)
        await seedDecoyPickupBid(leagueId, targetTeam)

        const picks = await factory.getDraftPicksForUser(leagueId, secondClient)
        const pick = picks[0]

        const { data: budgetBefore } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', bidderTeam)
          .single()

        const bidId = await seedCounterpickBid({
          leagueId,
          teamId: bidderTeam,
          movieId: pick.movie_id,
          targetTeamId: targetTeam,
          draftPickId: pick.id,
          amount: 5,
        })

        // The holder dropped the movie after the bid was placed.
        await serviceClient.from('draft_picks').update({ dropped_at: new Date().toISOString() }).eq('id', pick.id)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertExists(data.voided_counterpick_bids)
        assertEquals(
          data.voided_counterpick_bids.some((v: { bid_id: string }) => v.bid_id === bidId),
          true,
        )

        assertEquals(await bidStatus(bidId), 'cancelled')

        const { data: counterpick } = await serviceClient
          .from('counterpicks')
          .select('id')
          .eq('league_id', leagueId)
          .eq('movie_id', pick.movie_id)
          .maybeSingle()
        assertEquals(counterpick, null)

        const { data: budgetAfter } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', bidderTeam)
          .single()
        assertEquals(budgetAfter?.remaining_budget, budgetBefore?.remaining_budget)

        const bidderUserId = await getUserId(client)
        const notification = await latestNotification(bidderUserId, leagueId)
        assertExists(notification)
        assertEquals(notification?.type, 'bid_lost')
        assertEquals((notification?.data as Record<string, unknown>)?.reason, 'movie_dropped')
        assertEquals(
          (notification?.body as string).includes('not charged'),
          true,
          'voided-bid copy must say the budget was not charged',
        )
      })

      await t.step(
        "cancels a counterpick bid whose target was traded into the bidder's own team",
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-self-owned'), 2)
          await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

          const bidderTeam = await teamFor(leagueId, client)
          const targetTeam = await teamFor(leagueId, secondClient)
          await seedDecoyPickupBid(leagueId, targetTeam)

          const picks = await factory.getDraftPicksForUser(leagueId, secondClient)
          const pick = picks[0]

          const bidId = await seedCounterpickBid({
            leagueId,
            teamId: bidderTeam,
            movieId: pick.movie_id,
            targetTeamId: targetTeam,
            draftPickId: pick.id,
            amount: 5,
          })

          // Simulate a trade that hands the target movie to the bidder itself.
          await serviceClient.from('draft_picks').update({ team_id: bidderTeam }).eq('id', pick.id)

          const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)

          assertEquals(await bidStatus(bidId), 'cancelled')

          const { data: counterpick } = await serviceClient
            .from('counterpicks')
            .select('id')
            .eq('league_id', leagueId)
            .eq('movie_id', pick.movie_id)
            .maybeSingle()
          assertEquals(counterpick, null)

          const bidderUserId = await getUserId(client)
          const notification = await latestNotification(bidderUserId, leagueId)
          assertExists(notification)
          assertEquals((notification?.data as Record<string, unknown>)?.reason, 'target_owned')
        },
      )

      await t.step(
        'retargets a surviving bid at the current holder after a trade, not the stale stored target',
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-retarget'), 3)
          const thirdClient = await factory.createThirdClient()
          await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

          const bidderTeam = await teamFor(leagueId, client)
          const originalTargetTeam = await teamFor(leagueId, secondClient)
          const newHolderTeam = await teamFor(leagueId, thirdClient)
          await seedDecoyPickupBid(leagueId, originalTargetTeam)

          const picks = await factory.getDraftPicksForUser(leagueId, secondClient)
          const pick = picks[0]

          const bidId = await seedCounterpickBid({
            leagueId,
            teamId: bidderTeam,
            movieId: pick.movie_id,
            targetTeamId: originalTargetTeam,
            draftPickId: pick.id,
            amount: 5,
          })

          // Simulate a trade: the movie moved from the original target to a
          // third team before processing ran. The bid's stored target_team_id
          // still points at the original owner.
          await serviceClient.from('draft_picks').update({ team_id: newHolderTeam }).eq('id', pick.id)

          const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)
          assertEquals(data.counterpick_processed, 1)

          assertEquals(await bidStatus(bidId), 'won')

          const { data: counterpick } = await serviceClient
            .from('counterpicks')
            .select('target_team_id, counterpicker_team_id, draft_pick_id')
            .eq('league_id', leagueId)
            .eq('movie_id', pick.movie_id)
            .single()
          assertExists(counterpick)
          assertEquals(counterpick?.counterpicker_team_id, bidderTeam)
          assertEquals(
            counterpick?.target_team_id,
            newHolderTeam,
            'the awarded counterpick must target the current holder, not the stale bid.target_team_id',
          )

          const { data: draftPickAfter } = await serviceClient
            .from('draft_picks')
            .select('counterpicked_by_team_id')
            .eq('id', pick.id)
            .single()
          assertEquals(draftPickAfter?.counterpicked_by_team_id, bidderTeam)
        },
      )

      await t.step(
        'in a mixed contest, voids only the bid whose target went stale and lets the live re-acquired bid compete',
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-mixed'), 3)
          const thirdClient = await factory.createThirdClient()
          await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

          const teamA = await teamFor(leagueId, client)
          const teamB = await teamFor(leagueId, secondClient)
          const teamC = await teamFor(leagueId, thirdClient)
          await seedDecoyPickupBid(leagueId, teamB)

          // B holds a movie via the draft. A places a (soon-to-be-stale) bid on it.
          const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)
          const pick = picksB[0]

          const staleBidId = await seedCounterpickBid({
            leagueId,
            teamId: teamA,
            movieId: pick.movie_id,
            targetTeamId: teamB,
            draftPickId: pick.id,
            amount: 5,
          })

          // The movie is dropped by B, then immediately re-acquired by C via
          // pickup -- same movie, a brand new (live) holding row.
          await serviceClient.from('draft_picks').update({ dropped_at: new Date().toISOString() }).eq('id', pick.id)

          const { data: movieRow } = await serviceClient
            .from('movies')
            .select('tmdb_id')
            .eq('id', pick.movie_id)
            .single()
          assertExists(movieRow)

          const pickupId = await factory.createPickupForUser(leagueId, thirdClient, {
            tmdb_id: movieRow!.tmdb_id,
            title: pick.movie_title,
            release_date: '2099-01-01',
          })

          // B no longer holds the movie, so it is free to bid on the live pickup.
          const liveBidId = await seedCounterpickBid({
            leagueId,
            teamId: teamB,
            movieId: pick.movie_id,
            targetTeamId: teamC,
            pickupId,
            amount: 6,
          })

          const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)

          // The stale bid on the dropped draft pick dies...
          assertEquals(await bidStatus(staleBidId), 'cancelled')
          // ...while the live bid on the re-acquired pickup competes and wins.
          assertEquals(await bidStatus(liveBidId), 'won')
          assertEquals(data.counterpick_processed, 1)

          const { data: counterpick } = await serviceClient
            .from('counterpicks')
            .select('pickup_id, draft_pick_id, counterpicker_team_id, target_team_id')
            .eq('league_id', leagueId)
            .eq('movie_id', pick.movie_id)
            .single()
          assertExists(counterpick)
          assertEquals(counterpick?.pickup_id, pickupId)
          assertEquals(counterpick?.draft_pick_id, null)
          assertEquals(counterpick?.counterpicker_team_id, teamB)
          assertEquals(counterpick?.target_team_id, teamC)
        },
      )

      await t.step(
        "cancels a stranded 'outbid' bid when a contest's only active bid is voided",
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-stranded'), 3)
          const thirdClient = await factory.createThirdClient()
          await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

          const teamA = await teamFor(leagueId, client)
          const teamB = await teamFor(leagueId, secondClient)
          const teamC = await teamFor(leagueId, thirdClient)
          await seedDecoyPickupBid(leagueId, teamB)

          const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)
          const pick = picksB[0]

          const activeBidId = await seedCounterpickBid({
            leagueId,
            teamId: teamA,
            movieId: pick.movie_id,
            targetTeamId: teamB,
            draftPickId: pick.id,
            amount: 5,
          })
          // A previously-outbid bid on the same contest, still pending a response.
          const outbidBidId = await seedCounterpickBid({
            leagueId,
            teamId: teamC,
            movieId: pick.movie_id,
            targetTeamId: teamB,
            draftPickId: pick.id,
            amount: 3,
            status: 'outbid',
          })

          await serviceClient.from('draft_picks').update({ dropped_at: new Date().toISOString() }).eq('id', pick.id)

          const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)

          assertEquals(await bidStatus(activeBidId), 'cancelled')
          assertEquals(
            await bidStatus(outbidBidId),
            'cancelled',
            "the stranded 'outbid' bid must be swept, not left dangling",
          )

          const voidedIds = (data.voided_counterpick_bids ?? []).map((v: { bid_id: string }) => v.bid_id)
          assertEquals(voidedIds.includes(activeBidId), true)
          assertEquals(voidedIds.includes(outbidBidId), true)

          const { data: counterpick } = await serviceClient
            .from('counterpicks')
            .select('id')
            .eq('league_id', leagueId)
            .eq('movie_id', pick.movie_id)
            .maybeSingle()
          assertEquals(counterpick, null)
        },
      )

      await t.step(
        "promotes an 'outbid' bid whose own target is still live when every active bid is voided",
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-promote'), 3)
          const thirdClient = await factory.createThirdClient()
          await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

          const teamA = await teamFor(leagueId, client)
          const teamB = await teamFor(leagueId, secondClient)
          const teamC = await teamFor(leagueId, thirdClient)
          await seedDecoyPickupBid(leagueId, teamB)

          // B holds a movie via the draft. A leads the contest with a bid on
          // that draft pick; C sits behind it as 'outbid' -- but C's bid
          // references the movie's NEXT holding row (see below), not the pick.
          const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)
          const pick = picksB[0]

          const staleLeaderId = await seedCounterpickBid({
            leagueId,
            teamId: teamA,
            movieId: pick.movie_id,
            targetTeamId: teamB,
            draftPickId: pick.id,
            amount: 6,
          })

          // The movie is dropped by B and re-acquired by A via pickup, so A's
          // own leading bid dies at revalidation (it now owns the movie) --
          // leaving the contest with no active bid at all.
          await serviceClient.from('draft_picks').update({ dropped_at: new Date().toISOString() }).eq('id', pick.id)

          const { data: movieRow } = await serviceClient
            .from('movies')
            .select('tmdb_id')
            .eq('id', pick.movie_id)
            .single()
          assertExists(movieRow)

          const pickupId = await factory.createPickupForUser(leagueId, client, {
            tmdb_id: movieRow!.tmdb_id,
            title: pick.movie_title,
            release_date: '2099-01-01',
          })

          // C's bid was outbid by A earlier but targets the live pickup row,
          // so with A's leader gone it must be promoted and win -- not swept.
          const outbidBidId = await seedCounterpickBid({
            leagueId,
            teamId: teamC,
            movieId: pick.movie_id,
            targetTeamId: teamA,
            pickupId,
            amount: 3,
            status: 'outbid',
          })

          const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)

          assertEquals(await bidStatus(staleLeaderId), 'cancelled')
          assertEquals(
            await bidStatus(outbidBidId),
            'won',
            "an 'outbid' bid with a live target must be promoted when the leaders die, not swept",
          )
          assertEquals(data.counterpick_processed, 1)

          const { data: counterpick } = await serviceClient
            .from('counterpicks')
            .select('pickup_id, counterpicker_team_id, target_team_id')
            .eq('league_id', leagueId)
            .eq('movie_id', pick.movie_id)
            .single()
          assertExists(counterpick)
          assertEquals(counterpick?.pickup_id, pickupId)
          assertEquals(counterpick?.counterpicker_team_id, teamC)
          assertEquals(counterpick?.target_team_id, teamA)
        },
      )
    } finally {
      await factory.cleanup()
    }
  },
})
