/**
 * Integration tests for counterpick slot enforcement in process-bids (issue #24)
 *
 * Requires: npx supabase start
 */

import { assertEquals } from '@std/assert'
import {
  getServiceClient,
  createTestFactory,
  uniqueName,
} from './_setup.ts'
import {
  createProcessBidsCaller,
  PAST_DEADLINE,
  seedCounterpickBid as seedCounterpickBidRow,
  teamForOrThrow,
} from './_counterpick_helpers.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

Deno.test({
  name: 'process-bids counterpick slot enforcement',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const callProcessBids = await createProcessBidsCaller()

    /** Place an active counterpick bid straight into the table, already past its deadline. */
    const seedCounterpickBid = (
      leagueId: string,
      biddingTeamId: string,
      pick: { id: string; movie_id: string },
      targetTeamId: string,
      amount: number,
      priority = 1,
    ) =>
      seedCounterpickBidRow(serviceClient, {
        leagueId,
        teamId: biddingTeamId,
        movieId: pick.movie_id,
        targetTeamId,
        draftPickId: pick.id,
        amount,
        priority,
      })

    /** Which team, if any, holds the bidding counterpick on a movie. */
    async function counterpickerOf(leagueId: string, movieId: string) {
      const { data } = await serviceClient
        .from('counterpicks')
        .select('counterpicker_team_id')
        .eq('league_id', leagueId)
        .eq('movie_id', movieId)
        .eq('phase', 'bidding')
        .maybeSingle()
      return data?.counterpicker_team_id ?? null
    }

    async function countCounterpicks(leagueId: string, teamId: string) {
      const { count } = await serviceClient
        .from('counterpicks')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('counterpicker_team_id', teamId)
        .eq('phase', 'bidding')
      return count ?? 0
    }

    const teamFor = (leagueId: string, userClient: SupabaseClient) =>
      teamForOrThrow(factory, leagueId, userClient)

    try {
      // Other suites leave active bids behind; they would be swept into our runs.
      await serviceClient.from('pickup_bids').update({ status: 'lost' }).eq('status', 'active')
      await serviceClient.from('counterpick_bids').update({ status: 'lost' }).eq('status', 'active')

      await t.step(
        'awards no more bidding counterpicks than the league allows',
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-slots'), 3)
          const thirdClient = await factory.createThirdClient()

          // One slot per team, so winning two counterpicks is over quota by one.
          await serviceClient
            .from('leagues')
            .update({ bidding_counterpick_slots: 1 })
            .eq('id', leagueId)

          const teamA = await teamFor(leagueId, client)
          const teamB = await teamFor(leagueId, secondClient)
          const teamC = await teamFor(leagueId, thirdClient)

          const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)
          const picksC = await factory.getDraftPicksForUser(leagueId, thirdClient)

          // Team A is sole bidder on one of B's movies and one of C's movies.
          await seedCounterpickBid(leagueId, teamA, picksB[0], teamB, 5)
          await seedCounterpickBid(leagueId, teamA, picksC[0], teamC, 6)

          // process-bids returns early when there are no pending pickup bids, which
          // would skip the counterpick block entirely. Seed one so this step
          // exercises the counterpick path regardless of that separate defect.
          await serviceClient.from('pickup_bids').insert({
            league_id: leagueId,
            team_id: teamB,
            tmdb_id: 900_900_001,
            movie_data: {
              title: 'Slot Filler Pickup',
              poster_url: null,
              release_date: `${new Date().getFullYear() + 1}-12-15`,
              vote_average: 5,
              popularity: 10,
            },
            amount: 1,
            status: 'active',
            processing_deadline: PAST_DEADLINE,
          })

          const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)
          console.log('[repro] counterpick_processed:', data.counterpick_processed)

          const awarded = await countCounterpicks(leagueId, teamA)
          console.log(`[repro] team A holds ${awarded} bidding counterpick(s), limit is 1`)

          assertEquals(
            awarded,
            1,
            `Team A won ${awarded} bidding counterpicks but the league allows only 1`,
          )
        },
      )

      await t.step(
        'keeps the bid the team ranked first and passes the rest to the runner-up',
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-prio'), 3)
          const thirdClient = await factory.createThirdClient()

          await serviceClient
            .from('leagues')
            .update({ bidding_counterpick_slots: 1 })
            .eq('id', leagueId)

          const teamA = await teamFor(leagueId, client)
          const teamB = await teamFor(leagueId, secondClient)
          const teamC = await teamFor(leagueId, thirdClient)

          const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)
          const picksC = await factory.getDraftPicksForUser(leagueId, thirdClient)

          // A ranks the cheaper bid first, so priority -- not bid size -- should
          // decide which counterpick it keeps.
          await seedCounterpickBid(leagueId, teamA, picksB[0], teamB, 4, 1)
          await seedCounterpickBid(leagueId, teamA, picksC[0], teamC, 9, 2)
          // B trails A on C's movie and should inherit it once A is out of slots.
          await seedCounterpickBid(leagueId, teamB, picksC[0], teamC, 3, 1)

          const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)

          assertEquals(
            await counterpickerOf(leagueId, picksB[0].movie_id),
            teamA,
            'team A should keep the bid it ranked priority 1, despite bidding less on it',
          )
          assertEquals(
            await counterpickerOf(leagueId, picksC[0].movie_id),
            teamB,
            'the movie team A could not take should fall through to the runner-up',
          )
          assertEquals(await countCounterpicks(leagueId, teamA), 1)
        },
      )

      await t.step(
        'processes counterpick bids on a week with no pickup bids',
        async () => {
          const leagueId = await factory.createActiveLeague(uniqueName('cp-nopickup'), 2)

          await serviceClient
            .from('leagues')
            .update({ bidding_counterpick_slots: 1 })
            .eq('id', leagueId)

          const teamA = await teamFor(leagueId, client)
          const teamB = await teamFor(leagueId, secondClient)
          const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)

          // Deliberately no pickup_bids: process-bids used to return early before
          // reaching counterpick processing at all.
          await seedCounterpickBid(leagueId, teamA, picksB[0], teamB, 5, 1)

          const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
          assertEquals(status, 200)
          assertEquals(data.processed, 0)
          assertEquals(data.counterpick_processed, 1)
          assertEquals(await counterpickerOf(leagueId, picksB[0].movie_id), teamA)
        },
      )
    } finally {
      await factory.cleanup()
    }
  },
})
