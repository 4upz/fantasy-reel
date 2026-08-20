/**
 * Integration tests for per-offer trade expiry.
 *
 * Covers the picker-independent half of the feature: the bounds and the release
 * anchor as the SERVER sees them, the guards that refuse a lapsed offer before
 * the cron has swept it, and the sweep itself.
 *
 * Every request here goes straight to the Edge Function, which is the point --
 * the UI enforces the same bounds for a nicer error, but a crafted request
 * skips it entirely, and this is the layer that actually holds.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists, assert } from '@std/assert'
import {
  createTestFactory,
  getAnonClient,
  getServiceClient,
  invokeFunction,
  uniqueName,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const PROCESS_TRADES_URL =
  Deno.env.get('PROCESS_TRADES_URL') || `${SUPABASE_URL}/functions/v1/process-trades`

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function inHours(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString()
}

/** The instant a movie stops being upcoming: start of the day after release, UTC. */
function releaseBoundary(releaseDate: string): string {
  const [y, m, d] = releaseDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString()
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().split('T')[0]
}

Deno.test({
  name: 'trade-expiry',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const leagueId = await factory.createTradingLeague(uniqueName('Expiry League'))
    const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
    const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)
    assertExists(recipientTeam)
    assert(initiatorPicks.length > 0, 'test setup: initiator needs at least one holding')

    const offeredMovie = {
      movie_id: initiatorPicks[0].movie_id,
      source: 'draft_pick' as const,
      source_id: initiatorPicks[0].id,
    }

    /** Propose an offer with whatever expiry fields the caller wants to try. */
    async function propose(expiry: Record<string, unknown>) {
      return await invokeFunction<{ trade_offer: Record<string, unknown> }>(
        client,
        'propose-trade',
        {
          league_id: leagueId,
          recipient_team_id: recipientTeam!.teamId,
          offered_items: { movies: [offeredMovie], faab: 0 },
          requested_items: { movies: [], faab: 5 },
          ...expiry,
        },
      )
    }

    /** Force an offer past its clock without letting the sweep see it yet. */
    async function forceLapsed(tradeId: string) {
      const { error } = await serviceClient
        .from('trade_offers')
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', tradeId)
      assertEquals(error, null)
    }

    async function readOffer(tradeId: string) {
      const { data } = await serviceClient
        .from('trade_offers')
        .select('status, expires_at, expiry_anchor, expired_reason')
        .eq('id', tradeId)
        .single()
      return data
    }

    async function runProcessTrades() {
      const response = await fetch(PROCESS_TRADES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
      })
      return { status: response.status, data: await response.json() }
    }

    async function cleanupOffers() {
      await serviceClient.from('trade_offers').delete().eq('league_id', leagueId)
    }

    // ========================================================================
    // Fixed expiry: bounds, enforced server-side
    // ========================================================================

    await t.step('accepts an offer with no expiry, and it never lapses', async () => {
      const { data, error } = await propose({})
      assertEquals(error, null)
      assertEquals(data!.trade_offer.expires_at, null)
      assertEquals(data!.trade_offer.expiry_anchor, null)
      await cleanupOffers()
    })

    await t.step('stores a valid fixed expiry', async () => {
      const { data, error } = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })
      assertEquals(error, null)
      assertExists(data!.trade_offer.expires_at)
      assertEquals(data!.trade_offer.expiry_anchor, 'fixed')
      await cleanupOffers()
    })

    await t.step('rejects an expiry in the past', async () => {
      const { error, status } = await propose({ expires_at: inHours(-1), expiry_anchor: 'fixed' })
      assertEquals(status, 400)
      assert(error?.includes('at least'), `unexpected error: ${error}`)
    })

    await t.step('rejects a window under the minimum, sent straight to the function', async () => {
      // The picker would never submit this. That is exactly why it is tested
      // here: an edited min attribute or a direct call has to be refused too.
      const { error, status } = await propose({ expires_at: inHours(0.5), expiry_anchor: 'fixed' })
      assertEquals(status, 400)
      assert(error?.includes('at least'), `unexpected error: ${error}`)
    })

    await t.step('rejects a window over the maximum', async () => {
      const { error, status } = await propose({ expires_at: inHours(30 * 24), expiry_anchor: 'fixed' })
      assertEquals(status, 400)
      assert(error?.includes('longer than'), `unexpected error: ${error}`)
    })

    await t.step('rejects an expiry with no anchor', async () => {
      const { error, status } = await propose({ expires_at: inHours(48) })
      assertEquals(status, 400)
      assert(error?.includes('together'), `unexpected error: ${error}`)
    })

    await t.step('rejects an unparseable expiry', async () => {
      const { status } = await propose({ expires_at: 'next friday', expiry_anchor: 'fixed' })
      assertEquals(status, 400)
    })

    // ========================================================================
    // Release anchor
    // ========================================================================

    await t.step('release anchor resolves to the earliest release across both sides', async () => {
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)
      assert(recipientPicks.length > 0, 'test setup: recipient needs a holding')

      // The requested movie releases FIRST, so it -- not the offered one --
      // must set the clock.
      const soon = isoDate(10)
      const later = isoDate(40)
      await serviceClient.from('movies').update({ release_date: later }).eq('id', offeredMovie.movie_id)
      await serviceClient
        .from('movies')
        .update({ release_date: soon })
        .eq('id', recipientPicks[0].movie_id)

      const { data, error } = await invokeFunction<{ trade_offer: Record<string, unknown> }>(
        client,
        'propose-trade',
        {
          league_id: leagueId,
          recipient_team_id: recipientTeam!.teamId,
          offered_items: { movies: [offeredMovie], faab: 0 },
          requested_items: {
            movies: [
              {
                movie_id: recipientPicks[0].movie_id,
                source: 'draft_pick',
                source_id: recipientPicks[0].id,
              },
            ],
            faab: 0,
          },
          // A client-supplied timestamp must be ignored for a release anchor:
          // the server re-derives it from live release dates.
          expires_at: inHours(2),
          expiry_anchor: 'first_release',
        },
      )

      assertEquals(error, null)
      assertEquals(data!.trade_offer.expiry_anchor, 'first_release')
      assertEquals(data!.trade_offer.expires_at, releaseBoundary(soon))
      await cleanupOffers()
    })

    await t.step('release anchor is refused when no movie has a release date', async () => {
      await serviceClient.from('movies').update({ release_date: null }).eq('id', offeredMovie.movie_id)

      const { error, status } = await propose({ expiry_anchor: 'first_release' })
      assertEquals(status, 400)
      assert(error?.includes('release date'), `unexpected error: ${error}`)
    })

    await t.step('release anchor is refused when the movie is already out', async () => {
      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(-5) })
        .eq('id', offeredMovie.movie_id)

      const { error, status } = await propose({ expiry_anchor: 'first_release' })
      assertEquals(status, 400)
      assert(error?.includes('already released'), `unexpected error: ${error}`)

      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(30) })
        .eq('id', offeredMovie.movie_id)
    })

    // ========================================================================
    // The guards: a lapsed offer is refused before the sweep catches it
    // ========================================================================

    await t.step('accepting a lapsed offer is refused even before the sweep runs', async () => {
      const { data } = await propose({ expires_at: inHours(2), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceLapsed(tradeId)

      const { error, status } = await invokeFunction(secondClient, 'respond-trade', {
        trade_offer_id: tradeId,
        response: 'accept',
      })

      assertEquals(status, 400)
      assert(error?.includes('expired'), `unexpected error: ${error}`)

      // The refusal must not have moved the row.
      const offer = await readOffer(tradeId)
      assertEquals(offer!.status, 'proposed')
      await cleanupOffers()
    })

    await t.step('rejecting a lapsed offer still works', async () => {
      const { data } = await propose({ expires_at: inHours(2), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceLapsed(tradeId)

      const { error } = await invokeFunction(secondClient, 'respond-trade', {
        trade_offer_id: tradeId,
        response: 'reject',
      })

      assertEquals(error, null)
      assertEquals((await readOffer(tradeId))!.status, 'rejected')
      await cleanupOffers()
    })

    await t.step('countering a lapsed offer is refused', async () => {
      const { data } = await propose({ expires_at: inHours(2), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceLapsed(tradeId)

      const { error, status } = await invokeFunction(secondClient, 'counter-trade', {
        trade_offer_id: tradeId,
        counter_offered_items: { movies: [], faab: 3 },
        counter_requested_items: { movies: [offeredMovie], faab: 0 },
        expires_at: inHours(24),
        expiry_anchor: 'fixed',
      })

      assertEquals(status, 400)
      assert(error?.includes('expired'), `unexpected error: ${error}`)
      await cleanupOffers()
    })

    await t.step('a counter gets a fresh clock instead of inheriting the old one', async () => {
      // Close to lapsing: if the counter inherited this, it would die at once.
      const { data } = await propose({ expires_at: inHours(1.1), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string

      const { error } = await invokeFunction(secondClient, 'counter-trade', {
        trade_offer_id: tradeId,
        counter_offered_items: { movies: [], faab: 3 },
        counter_requested_items: { movies: [offeredMovie], faab: 0 },
        expires_at: inHours(72),
        expiry_anchor: 'fixed',
      })
      assertEquals(error, null)

      const offer = await readOffer(tradeId)
      assertEquals(offer!.status, 'countered')
      assert(
        new Date(offer!.expires_at as string).getTime() > Date.now() + 48 * HOUR_MS,
        'counter kept the original offer clock',
      )
      await cleanupOffers()
    })

    // ========================================================================
    // The sweep
    // ========================================================================

    await t.step('the sweep expires a lapsed offer once, with a reason', async () => {
      const { data } = await propose({ expires_at: inHours(2), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceLapsed(tradeId)

      const first = await runProcessTrades()
      assertEquals(first.status, 200)
      assert(first.data.expired_by_clock >= 1, 'sweep did not claim the lapsed offer')

      const offer = await readOffer(tradeId)
      assertEquals(offer!.status, 'expired')
      assertEquals(offer!.expired_reason, 'offer_window')

      // Claim and flip happen in one statement, so a second pass finds nothing
      // and nobody is notified twice.
      const second = await runProcessTrades()
      assertEquals(second.data.expired_by_clock, 0)
      await cleanupOffers()
    })

    await t.step('the sweep leaves an offer with no clock alone', async () => {
      const { data } = await propose({})
      const tradeId = data!.trade_offer.id as string

      await runProcessTrades()
      assertEquals((await readOffer(tradeId))!.status, 'proposed')
      await cleanupOffers()
    })

    await t.step('a release-anchored offer follows its movie, and lapses when it opens', async () => {
      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(20) })
        .eq('id', offeredMovie.movie_id)

      const { data } = await propose({ expiry_anchor: 'first_release' })
      const tradeId = data!.trade_offer.id as string
      assertEquals((await readOffer(tradeId))!.expires_at, releaseBoundary(isoDate(20)))

      // The studio pushes it back: the offer window moves with it.
      const pushed = isoDate(45)
      await serviceClient.from('movies').update({ release_date: pushed }).eq('id', offeredMovie.movie_id)
      const moved = await runProcessTrades()
      assert(moved.data.reresolved >= 1, 'anchored offer did not follow the release date')
      assertEquals((await readOffer(tradeId))!.expires_at, releaseBoundary(pushed))

      // Now it opens early -- re-resolution and the sweep run in the same pass.
      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(-2) })
        .eq('id', offeredMovie.movie_id)
      await runProcessTrades()

      const offer = await readOffer(tradeId)
      assertEquals(offer!.status, 'expired')
      assertEquals(offer!.expired_reason, 'movie_released')
      await cleanupOffers()
    })

    await t.step('requires authentication', async () => {
      const anonClient = getAnonClient()
      const { status } = await invokeFunction(anonClient, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam!.teamId,
        offered_items: { movies: [], faab: 1 },
        requested_items: { movies: [], faab: 0 },
        expires_at: inHours(24),
        expiry_anchor: 'fixed',
      })
      assertEquals(status, 401)
    })
  },
})
