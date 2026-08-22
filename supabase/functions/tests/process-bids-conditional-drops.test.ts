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
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

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

/** The service role key the Edge Function runtime actually uses. */
async function getEdgeFunctionServiceRoleKey(): Promise<string> {
  try {
    const cmd = new Deno.Command('docker', {
      args: ['exec', 'supabase_edge_runtime_fantasy-reel', 'printenv', 'SUPABASE_SERVICE_ROLE_KEY'],
      stdout: 'piped',
      stderr: 'piped',
    })
    const output = await cmd.output()
    if (output.success) {
      const key = new TextDecoder().decode(output.stdout).trim()
      if (key) return key
    }
  } catch {
    // Docker not available or container not found
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

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
}

async function seedBid(
  serviceClient: SupabaseClient,
  options: SeedBidOptions,
): Promise<string> {
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
      status: 'active',
      priority: options.priority ?? 1,
      conditional_drop_pickup_id: options.conditionalDropPickupId ?? null,
      conditional_drop_draft_pick_id: options.conditionalDropDraftPickId ?? null,
      processing_deadline: dueDeadline(),
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

    try {
      await t.step('a conditional drop buys room on a full roster', async () => {
        await clearPendingBids()

        const leagueId = await factory.createActiveLeague(uniqueName('CondDrop'))
        const team = (await factory.getTeamForUser(leagueId, client))!

        // Fill the roster: total_slots holdings, so nothing fits without a drop.
        const { data: league } = await serviceClient
          .from('leagues')
          .select('total_slots')
          .eq('id', leagueId)
          .single()

        const { count: heldCount } = await serviceClient
          .from('team_holdings')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.teamId)

        const pickupIds: string[] = []
        for (let i = (heldCount ?? 0); i < (league!.total_slots as number); i++) {
          pickupIds.push(
            await factory.createPickupForUser(leagueId, client, {
              tmdb_id: uniqueVoidTestTmdbId(),
              title: `Filler ${i}`,
              release_date: '2099-06-01',
            }),
          )
        }

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

        const { data: league } = await serviceClient
          .from('leagues').select('total_slots').eq('id', leagueId).single()
        const { count: heldCount } = await serviceClient
          .from('team_holdings')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', fullTeam.teamId)

        for (let i = (heldCount ?? 0); i < (league!.total_slots as number); i++) {
          await factory.createPickupForUser(leagueId, client, {
            tmdb_id: uniqueVoidTestTmdbId(),
            title: `Filler ${i}`,
            release_date: '2099-06-01',
          })
        }

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

        const { data: league } = await serviceClient
          .from('leagues').select('total_slots').eq('id', leagueId).single()
        const { count: heldCount } = await serviceClient
          .from('team_holdings')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.teamId)

        // Leave exactly one free slot.
        for (let i = (heldCount ?? 0); i < (league!.total_slots as number) - 1; i++) {
          await factory.createPickupForUser(leagueId, client, {
            tmdb_id: uniqueVoidTestTmdbId(),
            title: `Filler ${i}`,
            release_date: '2099-06-01',
          })
        }

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
        // Uncontested and unawarded: it stays pending for a later run rather
        // than being marked lost, because capacity may free up.
        assertEquals(byId.get(spareId), 'active')
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
