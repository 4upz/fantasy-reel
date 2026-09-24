/**
 * Integration tests for pickup bid priority and conditional drops.
 *
 * A team may bid past a full roster. Priority decides which of its own winning
 * bids it keeps; a conditional drop buys room for one that would not otherwise
 * fit. See docs/superpowers/specs/2026-08-20-pickup-bid-priority-conditional-drops-design.md
 *
 * Requires: npx supabase start
 *
 * The `supabase start` edge runtime serves the *main checkout's* functions, so a
 * worktree change is only exercised by pointing PROCESS_BIDS_URL at a standalone
 * `deno run --allow-all --env-file=.env.test process-bids/index.ts` (binds :8000).
 */

import { assertEquals } from '@std/assert'
import { SupabaseClient } from '@supabase/supabase-js'
import { getEdgeFunctionServiceRoleKey, getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

/**
 * A tmdb_id outside the real TMDb range and outside every other suite's void
 * range (process-bids uses 950m+, place-bid 960m+), so these tests cannot
 * corrupt the shared draft-movie pool.
 */
function uniqueVoidTestTmdbId(): number {
  return 970_000_000 + Math.floor(Math.random() * 1_000_000)
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const STANDALONE_URL = Deno.env.get('PROCESS_BIDS_URL')
const FUNCTION_URL = STANDALONE_URL || `${SUPABASE_URL}/functions/v1/process-bids`

/** A bid already due for processing. */
function dueDeadline(): string {
  return new Date(Date.now() - 60_000).toISOString()
}

interface SeedBidOptions {
  leagueId: string
  teamId: string
  tmdbId: number
  amount: number
  priority?: number
  conditionalDropPickupId?: string | null
  conditionalDropDraftPickId?: string | null
  /** 'outbid' seeds a bid whose counter window has already closed. */
  status?: 'active' | 'outbid'
}

async function seedBid(
  serviceClient: SupabaseClient,
  options: SeedBidOptions,
): Promise<string> {
  const outbid = options.status === 'outbid'
  const { data, error } = await serviceClient
    .from('pickup_bids')
    .insert({
      league_id: options.leagueId,
      team_id: options.teamId,
      tmdb_id: options.tmdbId,
      movie_data: {
        title: `Bid Target ${options.tmdbId}`,
        release_date: '2099-01-01',
        vote_average: 5,
        popularity: 10,
        poster_url: null,
      },
      amount: options.amount,
      status: options.status ?? 'active',
      priority: options.priority ?? 1,
      conditional_drop_pickup_id: options.conditionalDropPickupId ?? null,
      conditional_drop_draft_pick_id: options.conditionalDropDraftPickId ?? null,
      processing_deadline: dueDeadline(),
      countered_at: outbid ? new Date(Date.now() - 2 * 3600_000).toISOString() : null,
      response_deadline: outbid ? new Date(Date.now() - 3600_000).toISOString() : null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to seed bid: ${error.message}`)
  return data.id as string
}

Deno.test({
  name: 'process-bids conditional drops and priority',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = STANDALONE_URL
      ? (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      : await getEdgeFunctionServiceRoleKey()

    async function callProcessBids(body?: Record<string, unknown>) {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      try {
        return { status: response.status, data: JSON.parse(text) }
      } catch {
        return { status: response.status, data: { raw: text } }
      }
    }

    /** Bids from other suites must not be swept into these runs. */
    async function clearPendingBids() {
      await serviceClient.from('pickup_bids').update({ status: 'lost' }).in('status', ['active', 'outbid'])
      await serviceClient.from('counterpick_bids').update({ status: 'lost' }).in('status', ['active', 'outbid'])
    }

    /**
     * Fill a team's roster with unreleased pickups, leaving `leaveFree` slots.
     * @returns the pickups created -- each a valid conditional drop target.
     */
    async function fillRoster(
      leagueId: string,
      userClient: SupabaseClient,
      teamId: string,
      leaveFree = 0,
    ): Promise<string[]> {
      const { data: league } = await serviceClient
        .from('leagues').select('total_slots').eq('id', leagueId).single()
      const { count: heldCount } = await serviceClient
        .from('team_holdings')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', teamId)

      const pickupIds: string[] = []
      for (let i = (heldCount ?? 0); i < (league!.total_slots as number) - leaveFree; i++) {
        pickupIds.push(
          await factory.createPickupForUser(leagueId, userClient, {
            tmdb_id: uniqueVoidTestTmdbId(),
            title: `Filler ${i}`,
            release_date: '2099-06-01',
          }),
        )
      }
      return pickupIds
    }

    /** The loss reason a bidder was notified of, or undefined if none was sent. */
    async function lossReasonFor(leagueId: string, bidId: string): Promise<unknown> {
      const { data } = await serviceClient
        .from('notifications')
        .select('data')
        .eq('league_id', leagueId)
        .eq('type', 'bid_lost')
        .eq('data->>bid_id', bidId)
        .maybeSingle()
      return data?.data?.loss_reason
    }

    try {
      await t.step('a conditional drop buys room on a full roster', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('CondDrop'))
        const team = (await factory.getTeamForUser(leagueId, client))!

        // Fill the roster: total_slots holdings, so nothing fits without a drop.
        const pickupIds = await fillRoster(leagueId, client, team.teamId)

        const dropTarget = pickupIds[0]
        const targetTmdbId = uniqueVoidTestTmdbId()
        const bidId = await seedBid(serviceClient, {
          leagueId,
          teamId: team.teamId,
          tmdbId: targetTmdbId,
          amount: 5,
          conditionalDropPickupId: dropTarget,
        })

        const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)

        // The bid won...
        const { data: bid } = await serviceClient
          .from('pickup_bids').select('status').eq('id', bidId).single()
        assertEquals(bid!.status, 'won')

        // ...the named holding was released...
        const { data: dropped } = await serviceClient
          .from('pickups').select('dropped_at').eq('id', dropTarget).single()
        assertEquals(dropped!.dropped_at !== null, true)

        // ...and exactly one drop was charged against drop_limit.
        const { count: dropCount } = await serviceClient
          .from('team_drops')
          .select('*', { count: 'exact', head: true })
          .eq('pickup_id', dropTarget)
        assertEquals(dropCount, 1)
      })

      await t.step('a full roster with no conditional drop loses to the runner-up', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('NoRoom'))
        const fullTeam = (await factory.getTeamForUser(leagueId, client))!
        const roomyTeam = (await factory.getTeamForUser(leagueId, secondClient))!

        await fillRoster(leagueId, client, fullTeam.teamId)

        const contested = uniqueVoidTestTmdbId()
        // The full team bids higher, but has nowhere to put the movie.
        const highBidId = await seedBid(serviceClient, {
          leagueId, teamId: fullTeam.teamId, tmdbId: contested, amount: 20,
        })
        const lowBidId = await seedBid(serviceClient, {
          leagueId, teamId: roomyTeam.teamId, tmdbId: contested, amount: 3,
        })

        const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)

        const { data: bids } = await serviceClient
          .from('pickup_bids').select('id, status').in('id', [highBidId, lowBidId])
        const byId = new Map(bids!.map((b) => [b.id, b.status]))

        // The movie falls through to the runner-up rather than going unawarded.
        assertEquals(byId.get(lowBidId), 'won')
        assertEquals(byId.get(highBidId), 'lost')
      })

      await t.step('priority decides which of two wins a team keeps', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('Priority'))
        const team = (await factory.getTeamForUser(leagueId, client))!

        // Leave exactly one free slot.
        await fillRoster(leagueId, client, team.teamId, 1)

        // The cheaper bid is ranked first: priority, not amount, decides which
        // of a team's OWN wins it keeps.
        const wantedId = await seedBid(serviceClient, {
          leagueId, teamId: team.teamId, tmdbId: uniqueVoidTestTmdbId(), amount: 5, priority: 1,
        })
        const spareId = await seedBid(serviceClient, {
          leagueId, teamId: team.teamId, tmdbId: uniqueVoidTestTmdbId(), amount: 40, priority: 2,
        })

        const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)

        const { data: bids } = await serviceClient
          .from('pickup_bids').select('id, status').in('id', [wantedId, spareId])
        const byId = new Map(bids!.map((b) => [b.id, b.status]))

        assertEquals(byId.get(wantedId), 'won')
        // Uncontested but out of room: it loses now. Left pending it could no
        // longer be cancelled, yet would win whenever a slot next freed up.
        assertEquals(byId.get(spareId), 'lost')
        assertEquals(await lossReasonFor(leagueId, spareId), 'no_slots')
      })

      await t.step('two bids naming the same conditional drop: only the higher priority is honored', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('SameDrop'))
        const team = (await factory.getTeamForUser(leagueId, client))!
        const [dropTarget] = await fillRoster(leagueId, client, team.teamId)
        const { count: rosterSize } = await serviceClient
          .from('team_holdings')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.teamId)

        // Both bids fund themselves with the same drop. The second is ranked
        // lower -- and bids more, so amount cannot be what decides.
        const firstId = await seedBid(serviceClient, {
          leagueId, teamId: team.teamId, tmdbId: uniqueVoidTestTmdbId(), amount: 5, priority: 1,
          conditionalDropPickupId: dropTarget,
        })
        const secondId = await seedBid(serviceClient, {
          leagueId, teamId: team.teamId, tmdbId: uniqueVoidTestTmdbId(), amount: 8, priority: 2,
          conditionalDropPickupId: dropTarget,
        })

        const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)

        const { data: bids } = await serviceClient
          .from('pickup_bids').select('id, status').in('id', [firstId, secondId])
        const byId = new Map(bids!.map((b) => [b.id, b.status]))

        // The first cashes the drop...
        assertEquals(byId.get(firstId), 'won')
        const { data: dropped } = await serviceClient
          .from('pickups').select('dropped_at').eq('id', dropTarget).single()
        assertEquals(dropped!.dropped_at !== null, true)
        const { count: dropCount } = await serviceClient
          .from('team_drops')
          .select('*', { count: 'exact', head: true })
          .eq('pickup_id', dropTarget)
        assertEquals(dropCount, 1)

        // ...so the second has no room left and loses this run, rather than
        // carrying into next week's processing.
        assertEquals(byId.get(secondId), 'lost')
        assertEquals(await lossReasonFor(leagueId, secondId), 'no_slots')

        const { count: stillPending } = await serviceClient
          .from('pickup_bids')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.teamId)
          .in('status', ['active', 'outbid'])
        assertEquals(stillPending, 0)

        // One movie in, one out: the roster is exactly as full as before.
        const { count: heldAfter } = await serviceClient
          .from('team_holdings')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.teamId)
        assertEquals(heldAfter, rosterSize)
      })

      await t.step('a movie no bidder can take closes out its outbid bids too', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('Unawarded'))
        const fullTeam = (await factory.getTeamForUser(leagueId, client))!
        const otherTeam = (await factory.getTeamForUser(leagueId, secondClient))!
        await fillRoster(leagueId, client, fullTeam.teamId)

        // The leader has no room; the team it outbid let its counter window
        // lapse. Only the leader is weighed, so nobody wins the movie.
        const contested = uniqueVoidTestTmdbId()
        const leaderId = await seedBid(serviceClient, {
          leagueId, teamId: fullTeam.teamId, tmdbId: contested, amount: 20,
        })
        const outbidId = await seedBid(serviceClient, {
          leagueId, teamId: otherTeam.teamId, tmdbId: contested, amount: 10, status: 'outbid',
        })

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertEquals(data.unawarded_pickups?.length, 1)

        const { data: bids } = await serviceClient
          .from('pickup_bids').select('id, status').in('id', [leaderId, outbidId])
        const byId = new Map(bids!.map((b) => [b.id, b.status]))
        assertEquals(byId.get(leaderId), 'lost')
        assertEquals(byId.get(outbidId), 'lost')

        // Each bidder is told what actually stopped them.
        assertEquals(await lossReasonFor(leagueId, leaderId), 'no_slots')
        assertEquals(await lossReasonFor(leagueId, outbidId), 'outbid')

        const { count: awarded } = await serviceClient
          .from('pickups')
          .select('*', { count: 'exact', head: true })
          .in('bid_id', [leaderId, outbidId])
        assertEquals(awarded, 0)
      })

      await t.step('a losing bid never fires its conditional drop', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('LoserDrop'))
        const loser = (await factory.getTeamForUser(leagueId, client))!
        const winner = (await factory.getTeamForUser(leagueId, secondClient))!

        const keepMe = await factory.createPickupForUser(leagueId, client, {
          tmdb_id: uniqueVoidTestTmdbId(),
          title: 'Should Survive',
          release_date: '2099-06-01',
        })

        const contested = uniqueVoidTestTmdbId()
        await seedBid(serviceClient, {
          leagueId, teamId: loser.teamId, tmdbId: contested, amount: 2,
          conditionalDropPickupId: keepMe,
        })
        await seedBid(serviceClient, {
          leagueId, teamId: winner.teamId, tmdbId: contested, amount: 30,
        })

        const { status } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)

        // Outbid, so the drop must not have happened.
        const { data: survivor } = await serviceClient
          .from('pickups').select('dropped_at').eq('id', keepMe).single()
        assertEquals(survivor!.dropped_at, null)

        const { count: dropCount } = await serviceClient
          .from('team_drops')
          .select('*', { count: 'exact', head: true })
          .eq('pickup_id', keepMe)
        assertEquals(dropCount, 0)
      })
    } finally {
      await factory.cleanup()
    }
  },
})
