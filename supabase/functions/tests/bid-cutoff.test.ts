/**
 * Integration tests for the new-bid cutoff.
 *
 * Covers the wiring: that place-bid and cancel-bid read
 * leagues.new_bid_cutoff_hours, consult the shared bid-window helper, and
 * refuse accordingly. The boundary arithmetic itself is exhaustively covered by
 * the pure unit tests in _shared/bid-window.test.ts -- these tests only prove
 * the Edge Functions are actually asking.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestFactory, getServiceClient, uniqueName, invokeFunction } from './_setup.ts'

const currentYear = new Date().getFullYear()
const testMovieData = {
  title: 'Cutoff Test Movie',
  overview: 'A test movie for the new-bid cutoff',
  poster_url: '/cutoff-poster.jpg',
  release_date: `${currentYear}-12-20`,
  vote_average: 0,
  popularity: 100,
  genre_ids: [28],
}

/** tmdb_ids outside every other test file's range (see place-bid.test.ts). */
let nextTmdbId = 970_000_000
function freshTmdbId(): number {
  return nextTmdbId++
}

/**
 * The smallest allowed new_bid_cutoff_hours that puts a league's cutoff in the
 * past *right now*, or null when no allowed value can.
 *
 * The cutoff is `get_next_processing_deadline() - hours`, and that deadline is
 * computed live inside place-bid, so a test cannot pin it. What it can do is
 * widen the offset until the cutoff falls behind the current moment. The column
 * caps at 144 (see the migration), so this fails only in the first ~24 hours of
 * a bidding cycle -- Saturday 8pm to Sunday 8pm UTC -- where even a 144-hour
 * offset still lands in the future. Those runs skip the closed-window steps
 * rather than assert something time-dependent.
 */
async function hoursThatCloseTheWindow(serviceClient: SupabaseClient): Promise<number | null> {
  const { data } = await serviceClient.rpc('get_next_processing_deadline')
  const hoursUntilDeadline = (new Date(data as string).getTime() - Date.now()) / 3_600_000
  const needed = Math.ceil(hoursUntilDeadline)
  return needed <= 144 ? Math.max(needed, 1) : null
}

async function setCutoffHours(
  serviceClient: SupabaseClient,
  leagueId: string,
  hours: number,
): Promise<void> {
  const { error } = await serviceClient
    .from('leagues')
    .update({ new_bid_cutoff_hours: hours })
    .eq('id', leagueId)
  if (error) throw new Error(`Failed to set cutoff hours: ${error.message}`)
}

Deno.test({
  name: 'new-bid cutoff',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const closedHours = await hoursThatCloseTheWindow(serviceClient)
    const skipClosedSteps = closedHours === null

    if (skipClosedSteps) {
      console.warn(
        '[bid-cutoff] Early in the bidding cycle: no allowed cutoff offset lands in the past. ' +
          'Skipping the closed-window steps; the open-window steps still run.',
      )
    }

    // ========================================================================
    // Open phase (cutoff disabled) -- deterministic at any time of week
    // ========================================================================

    await t.step('a league with the cutoff disabled accepts a brand-new bid', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cutoff-disabled'))
      await setCutoffHours(serviceClient, leagueId, 0)
      const tmdbId = freshTmdbId()

      const { data, error } = await client.functions.invoke('place-bid', {
        body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
      })

      assertEquals(error, null)
      assertExists(data.bid)
      assertEquals(data.bid.status, 'active')
    })

    await t.step('a league with the cutoff disabled still allows cancelling', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cutoff-disabled-cancel'))
      await setCutoffHours(serviceClient, leagueId, 0)
      const tmdbId = freshTmdbId()

      const { data: placed } = await client.functions.invoke('place-bid', {
        body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
      })

      const { data, error } = await client.functions.invoke('cancel-bid', {
        body: { bid_id: placed.bid.id },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Bid cancelled successfully')
    })

    // ========================================================================
    // Counter-bid phase -- the Fantasy Critic rule
    // ========================================================================

    await t.step({
      name: 'refuses a bid on a movie nobody is bidding on',
      ignore: skipClosedSteps,
      fn: async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cutoff-blocks-new'))
        await setCutoffHours(serviceClient, leagueId, closedHours!)

        const { data, error } = await invokeFunction(client, 'place-bid', {
          league_id: leagueId,
          tmdb_id: freshTmdbId(),
          amount: 10,
          movie_data: testMovieData,
        })

        assertEquals(data, null)
        assertEquals(String(error).includes('New bids closed'), true, String(error))
        assertEquals(String(error).includes('raise or counter'), true, String(error))
      },
    })

    await t.step({
      name: 'allows joining a contest another team already started',
      ignore: skipClosedSteps,
      fn: async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cutoff-allows-join'))
        const tmdbId = freshTmdbId()

        // Open the contest while the window is still open...
        await setCutoffHours(serviceClient, leagueId, 0)
        const { data: opened } = await client.functions.invoke('place-bid', {
          body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
        })
        assertExists(opened.bid)

        // ...then close it and have a second team pile in.
        await setCutoffHours(serviceClient, leagueId, closedHours!)
        const { data, error } = await secondClient.functions.invoke('place-bid', {
          body: { league_id: leagueId, tmdb_id: tmdbId, amount: 20, movie_data: testMovieData },
        })

        assertEquals(error, null)
        assertExists(data.bid)
        assertEquals(data.bid.amount, 20)
        assertEquals(data.message, 'You are now the highest bidder')
      },
    })

    await t.step({
      name: 'allows raising your own bid',
      ignore: skipClosedSteps,
      fn: async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cutoff-allows-raise'))
        const tmdbId = freshTmdbId()

        await setCutoffHours(serviceClient, leagueId, 0)
        await client.functions.invoke('place-bid', {
          body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
        })

        await setCutoffHours(serviceClient, leagueId, closedHours!)
        const { data, error } = await client.functions.invoke('place-bid', {
          body: { league_id: leagueId, tmdb_id: tmdbId, amount: 25, movie_data: testMovieData },
        })

        assertEquals(error, null)
        assertExists(data.bid)
        assertEquals(data.bid.amount, 25)
        assertEquals(data.was_update, true)
      },
    })

    await t.step({
      name: 'a movie whose only bid was cancelled counts as uncontested again',
      ignore: skipClosedSteps,
      fn: async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cutoff-cancelled'))
        const tmdbId = freshTmdbId()

        await setCutoffHours(serviceClient, leagueId, 0)
        const { data: placed } = await client.functions.invoke('place-bid', {
          body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
        })
        await client.functions.invoke('cancel-bid', { body: { bid_id: placed.bid.id } })

        // Nobody is bidding on it now, so reopening it after the cutoff is
        // exactly what the rule forbids -- including for the team that bailed.
        await setCutoffHours(serviceClient, leagueId, closedHours!)
        const { data, error } = await invokeFunction(secondClient, 'place-bid', {
          league_id: leagueId,
          tmdb_id: tmdbId,
          amount: 15,
          movie_data: testMovieData,
        })

        assertEquals(data, null)
        assertEquals(String(error).includes('New bids closed'), true, String(error))
      },
    })

    // ========================================================================
    // Cancels are locked in the counter-bid phase
    // ========================================================================

    await t.step({
      name: 'refuses to cancel a bid once the cutoff has passed',
      ignore: skipClosedSteps,
      fn: async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cutoff-blocks-cancel'))
        const tmdbId = freshTmdbId()

        await setCutoffHours(serviceClient, leagueId, 0)
        const { data: placed } = await client.functions.invoke('place-bid', {
          body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
        })

        await setCutoffHours(serviceClient, leagueId, closedHours!)
        const { data, error } = await invokeFunction(client, 'cancel-bid', {
          bid_id: placed.bid.id,
        })

        assertEquals(data, null)
        assertEquals(String(error).includes('locked in for this week'), true, String(error))

        // The bid is untouched, not quietly half-cancelled.
        const { data: after } = await serviceClient
          .from('pickup_bids')
          .select('status')
          .eq('id', placed.bid.id)
          .single()
        assertEquals(after?.status, 'active')
      },
    })

    /**
     * Deterministic at any time of week, unlike the steps above: cancel-bid
     * anchors its window to the bid's *own* processing_deadline, which is a
     * stored column a test can move. This is the extended-time hole -- after
     * Saturday 8pm the next cutoff is days away and the phase reads as open
     * again, while the bid is still waiting on the hourly process-bids run.
     */
    await t.step('refuses to cancel a bid that is already being processed', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cutoff-in-processing'))
      await setCutoffHours(serviceClient, leagueId, 0)
      const tmdbId = freshTmdbId()

      const { data: placed } = await client.functions.invoke('place-bid', {
        body: { league_id: leagueId, tmdb_id: tmdbId, amount: 10, movie_data: testMovieData },
      })

      await serviceClient
        .from('pickup_bids')
        .update({ processing_deadline: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', placed.bid.id)

      const { data, error } = await invokeFunction(client, 'cancel-bid', {
        bid_id: placed.bid.id,
      })

      assertEquals(data, null)
      assertEquals(String(error).includes('already being processed'), true, String(error))

      const { data: after } = await serviceClient
        .from('pickup_bids')
        .select('status')
        .eq('id', placed.bid.id)
        .single()
      assertEquals(after?.status, 'active')
    })
  },
})
