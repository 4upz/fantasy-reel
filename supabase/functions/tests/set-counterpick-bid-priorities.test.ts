/**
 * Integration tests for set-counterpick-bid-priorities
 *
 * The `supabase start` edge runtime serves the main checkout's functions, so this
 * suite needs the worktree copy running standalone:
 *   deno run --allow-all --env-file=.env.test set-counterpick-bid-priorities/index.ts
 * then point PRIORITIES_URL at it (defaults to the container route otherwise).
 */

import { assertEquals } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = Deno.env.get('PRIORITIES_URL') ||
  `${SUPABASE_URL}/functions/v1/set-counterpick-bid-priorities`

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

Deno.test({
  name: 'set-counterpick-bid-priorities',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    async function callAs(userClient: SupabaseClient, body: Record<string, unknown>) {
      const { data: { session } } = await userClient.auth.getSession()
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session!.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      try {
        return { status: response.status, data: JSON.parse(text) }
      } catch {
        return { status: response.status, data: { raw: text } }
      }
    }

    async function prioritiesByBid(leagueId: string, teamId: string) {
      const { data } = await serviceClient
        .from('counterpick_bids')
        .select('id, priority')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .in('status', ['active', 'outbid'])
      return Object.fromEntries((data ?? []).map((bid) => [bid.id, bid.priority]))
    }

    try {
      const leagueId = await factory.createActiveLeague(uniqueName('cp-reorder'), 2)
      await serviceClient
        .from('leagues')
        .update({ bidding_counterpick_slots: 2 })
        .eq('id', leagueId)

      const teamA = (await factory.getTeamForUser(leagueId, client))!.teamId
      const teamB = (await factory.getTeamForUser(leagueId, secondClient))!.teamId
      const picksB = await factory.getDraftPicksForUser(leagueId, secondClient)

      // Three pending bids for team A, seeded in the order they were "placed".
      const bidIds: string[] = []
      for (let i = 0; i < 3; i++) {
        const { data, error } = await serviceClient
          .from('counterpick_bids')
          .insert({
            league_id: leagueId,
            team_id: teamA,
            movie_id: picksB[i].movie_id,
            target_team_id: teamB,
            draft_pick_id: picksB[i].id,
            amount: 5 + i,
            priority: i + 1,
            status: 'active',
            processing_deadline: FUTURE,
          })
          .select('id')
          .single()
        if (error) throw new Error(`Failed to seed bid: ${error.message}`)
        bidIds.push(data.id)
      }

      await t.step('rejects an unauthenticated caller', async () => {
        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league_id: leagueId, bid_ids: bidIds }),
        })
        assertEquals(response.status, 401)
      })

      await t.step('reorders the caller\'s pending bids', async () => {
        const reordered = [bidIds[2], bidIds[0], bidIds[1]]
        const { status, data } = await callAs(client, {
          league_id: leagueId,
          bid_ids: reordered,
        })

        assertEquals(status, 200)
        assertEquals(data.message, 'Bid priorities updated')

        const priorities = await prioritiesByBid(leagueId, teamA)
        assertEquals(priorities[bidIds[2]], 1)
        assertEquals(priorities[bidIds[0]], 2)
        assertEquals(priorities[bidIds[1]], 3)
      })

      await t.step('returns bids already sorted by priority', async () => {
        const { data } = await callAs(client, {
          league_id: leagueId,
          bid_ids: [bidIds[0], bidIds[1], bidIds[2]],
        })
        assertEquals(data.bids.map((bid: { id: string }) => bid.id), bidIds)
      })

      await t.step('rejects a partial list', async () => {
        const { status, data } = await callAs(client, {
          league_id: leagueId,
          bid_ids: [bidIds[0]],
        })
        assertEquals(status, 400)
        assertEquals(data.error, 'bid_ids must list all 3 of your pending counterpick bids')
      })

      await t.step('rejects duplicate ids', async () => {
        const { status, data } = await callAs(client, {
          league_id: leagueId,
          bid_ids: [bidIds[0], bidIds[0], bidIds[1]],
        })
        assertEquals(status, 400)
        assertEquals(data.error, 'bid_ids must not contain duplicates')
      })

      await t.step("rejects another team's bids", async () => {
        const { status, data } = await callAs(secondClient, {
          league_id: leagueId,
          bid_ids: bidIds,
        })
        assertEquals(status, 400)
        assertEquals(
          data.error,
          'You have no pending counterpick bids to reorder',
        )
      })

      await t.step('rejects a non-member', async () => {
        const otherLeagueId = await factory.createActiveLeague(uniqueName('cp-other'), 2)
        const thirdClient = await factory.createThirdClient()
        const { status } = await callAs(thirdClient, {
          league_id: otherLeagueId,
          bid_ids: bidIds,
        })
        assertEquals(status, 403)
      })

      await t.step('rejects a malformed league_id', async () => {
        const { status, data } = await callAs(client, {
          league_id: 'not-a-uuid',
          bid_ids: bidIds,
        })
        assertEquals(status, 400)
        assertEquals(data.error, 'Valid league_id is required')
      })
    } finally {
      await factory.cleanup()
    }
  },
})
