/**
 * Integration tests for set-bid-priorities
 *
 * The `supabase start` edge runtime serves the main checkout's functions, so this
 * suite needs the worktree copy running standalone:
 *   deno run --allow-all --env-file=.env.test set-bid-priorities/index.ts
 * then point PRIORITIES_URL at it (defaults to the container route otherwise).
 */

import { assertEquals } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = Deno.env.get('PRIORITIES_URL') ||
  `${SUPABASE_URL}/functions/v1/set-bid-priorities`

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

/** A tmdb_id outside the real range and every other suite's void range. */
function uniqueVoidTestTmdbId(): number {
  return 980_000_000 + Math.floor(Math.random() * 1_000_000)
}

Deno.test({
  name: 'set-bid-priorities',
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
        .from('pickup_bids')
        .select('id, priority')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .in('status', ['active', 'outbid'])
      return Object.fromEntries((data ?? []).map((bid) => [bid.id, bid.priority]))
    }

    async function seedBid(leagueId: string, teamId: string, index: number) {
      const tmdbId = uniqueVoidTestTmdbId()
      const { data, error } = await serviceClient
        .from('pickup_bids')
        .insert({
          league_id: leagueId,
          team_id: teamId,
          tmdb_id: tmdbId,
          movie_data: {
            title: `Priority Target ${tmdbId}`,
            release_date: '2099-01-01',
            vote_average: 5,
            popularity: 10,
            poster_url: null,
          },
          amount: 5 + index,
          priority: index + 1,
          status: 'active',
          processing_deadline: FUTURE,
        })
        .select('id')
        .single()
      if (error) throw new Error(`Failed to seed bid: ${error.message}`)
      return data.id as string
    }

    try {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-reorder'), 2)
      const teamA = (await factory.getTeamForUser(leagueId, client))!.teamId
      const teamB = (await factory.getTeamForUser(leagueId, secondClient))!.teamId

      // Three pending bids for team A, in the order they were "placed".
      const bidIds: string[] = []
      for (let i = 0; i < 3; i++) {
        bidIds.push(await seedBid(leagueId, teamA, i))
      }

      await t.step('rejects an unauthenticated caller', async () => {
        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league_id: leagueId, bid_ids: bidIds }),
        })
        assertEquals(response.status, 401)
      })

      await t.step("reorders the caller's pending bids", async () => {
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
        // Omitted bids would keep stale numbers and the caller could not tell
        // where they had landed, so the full set is required.
        const { status } = await callAs(client, {
          league_id: leagueId,
          bid_ids: [bidIds[0]],
        })
        assertEquals(status, 400)
      })

      await t.step('rejects duplicate ids', async () => {
        const { status } = await callAs(client, {
          league_id: leagueId,
          bid_ids: [bidIds[0], bidIds[0], bidIds[1]],
        })
        assertEquals(status, 400)
      })

      await t.step("rejects another team's bid", async () => {
        const foreignBidId = await seedBid(leagueId, teamB, 0)

        const { status } = await callAs(client, {
          league_id: leagueId,
          bid_ids: [bidIds[0], bidIds[1], bidIds[2], foreignBidId],
        })
        assertEquals(status, 400)
      })
    } finally {
      await factory.cleanup()
    }
  },
})
