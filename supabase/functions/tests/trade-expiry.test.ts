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

/**
 * Compare two timestamps as instants, not strings.
 *
 * Postgres hands timestamptz back through PostgREST as `+00:00`, while
 * Date.toISOString() writes `.000Z`. Same moment, different spelling.
 */
function assertSameInstant(actual: unknown, expected: string, msg?: string) {
  assertEquals(
    new Date(actual as string).getTime(),
    new Date(expected).getTime(),
    msg ?? `expected ${actual} to be the same instant as ${expected}`,
  )
}

/**
 * The service role key the EDGE RUNTIME actually uses, which is not the one in
 * .env.test -- the container gets its own. Cron auth compares against the
 * runtime's, so a test that sends .env.test's key gets a 403. Same approach as
 * process-bids.test.ts.
 */
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
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()

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
        .select('status, expires_at, expiry_anchor, expiry_anchor_movie_id, expired_reason')
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

    await t.step('release anchor defaults to the soonest unreleased movie, across both sides', async () => {
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
          // the server re-derives it from the anchor movie's live release date.
          expires_at: inHours(2),
          expiry_anchor: 'movie_release',
        },
      )

      assertEquals(error, null)
      assertEquals(data!.trade_offer.expiry_anchor, 'movie_release')
      assertEquals(data!.trade_offer.expiry_anchor_movie_id, recipientPicks[0].movie_id)
      assertSameInstant(data!.trade_offer.expires_at, releaseBoundary(soon))
      await cleanupOffers()
    })

    await t.step('the proposer can anchor to a LATER release instead of the soonest', async () => {
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)
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
          expiry_anchor: 'movie_release',
          // Explicitly the further-out movie, not the default.
          expiry_anchor_movie_id: offeredMovie.movie_id,
        },
      )

      assertEquals(error, null)
      assertEquals(data!.trade_offer.expiry_anchor_movie_id, offeredMovie.movie_id)
      assertSameInstant(data!.trade_offer.expires_at, releaseBoundary(later))
      await cleanupOffers()
    })

    await t.step('an already-released movie in the trade does not disqualify the option', async () => {
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)
      const upcoming = isoDate(30)
      // The offered movie is already out; the requested one is not.
      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(-40) })
        .eq('id', offeredMovie.movie_id)
      await serviceClient
        .from('movies')
        .update({ release_date: upcoming })
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
          expiry_anchor: 'movie_release',
        },
      )

      assertEquals(error, null)
      assertEquals(data!.trade_offer.expiry_anchor_movie_id, recipientPicks[0].movie_id)
      assertSameInstant(data!.trade_offer.expires_at, releaseBoundary(upcoming))
      await cleanupOffers()
    })

    await t.step('refuses an anchor movie that is not an unreleased movie in the offer', async () => {
      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(30) })
        .eq('id', offeredMovie.movie_id)

      const { error, status } = await propose({
        expiry_anchor: 'movie_release',
        expiry_anchor_movie_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(status, 400)
      assert(error?.includes('not an unreleased movie'), `unexpected error: ${error}`)
    })

    await t.step('release anchor is refused when nothing in the trade is unreleased', async () => {
      await serviceClient
        .from('movies')
        .update({ release_date: isoDate(-5) })
        .eq('id', offeredMovie.movie_id)

      const { error, status } = await propose({ expiry_anchor: 'movie_release' })
      assertEquals(status, 400)
      assert(error?.includes('still unreleased'), `unexpected error: ${error}`)

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

      const { data } = await propose({ expiry_anchor: 'movie_release' })
      const tradeId = data!.trade_offer.id as string
      assertEquals((await readOffer(tradeId))!.expiry_anchor_movie_id, offeredMovie.movie_id)
      assertSameInstant((await readOffer(tradeId))!.expires_at, releaseBoundary(isoDate(20)))

      // The studio pushes it back: the offer window moves with it.
      const pushed = isoDate(45)
      await serviceClient.from('movies').update({ release_date: pushed }).eq('id', offeredMovie.movie_id)
      const moved = await runProcessTrades()
      assert(moved.data.reresolved >= 1, 'anchored offer did not follow the release date')
      assertSameInstant((await readOffer(tradeId))!.expires_at, releaseBoundary(pushed))

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

    // ========================================================================
    // The "expiring soon" nudge
    //
    // Due-ness depends on the whole window, not just what is left:
    // min(6h, 25% of the window) remaining, and nothing under a 2h window. So
    // these steps have to control BOTH ends of the clock, which means writing
    // the start back through the service client -- propose-trade will not
    // create an offer that started two days ago.
    // ========================================================================

    /**
     * Rewrite an offer's clock so it looks `remaining` hours from lapsing on a
     * window that was `windowHours` long all along.
     *
     * `countered` because claim_expiry_reminders measures the window from
     * COALESCE(responded_at, proposed_at): counter_trade reuses the row and
     * stamps responded_at, so for a countered offer that is where the current
     * clock started.
     */
    async function forceDue(
      tradeId: string,
      windowHours: number,
      remainingHours: number,
      options?: { countered?: boolean },
    ) {
      const start = new Date(Date.now() - (windowHours - remainingHours) * HOUR_MS).toISOString()
      const { error } = await serviceClient
        .from('trade_offers')
        .update({
          proposed_at: start,
          ...(options?.countered ? { responded_at: start } : {}),
          expires_at: new Date(Date.now() + remainingHours * HOUR_MS).toISOString(),
        })
        .eq('id', tradeId)
      assertEquals(error, null)
    }

    async function reminderStamp(tradeId: string): Promise<string | null> {
      const { data } = await serviceClient
        .from('trade_offers')
        .select('expiry_reminder_sent_at')
        .eq('id', tradeId)
        .single()
      return (data?.expiry_reminder_sent_at as string | null) ?? null
    }

    await t.step('nudges an offer inside its lead time, exactly once', async () => {
      const { data } = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      assertEquals(await reminderStamp(tradeId), null)

      // A 48h window caps at the 6h lead; 1h left is well inside it.
      await forceDue(tradeId, 48, 1)

      const first = await runProcessTrades()
      assertEquals(first.status, 200)
      assert(first.data.expiry_reminders_sent >= 1, 'the nudge did not claim the offer')

      const stamped = await reminderStamp(tradeId)
      assertExists(stamped)

      // Claim and stamp happen in one statement, so a second pass finds nothing
      // and nobody is told twice. The offer is still open and still inside its
      // lead time -- only the stamp keeps it from firing again.
      const second = await runProcessTrades()
      assertEquals(second.data.expiry_reminders_sent, 0)
      assertSameInstant(await reminderStamp(tradeId), stamped!, 'the offer was nudged twice')
      assertEquals((await readOffer(tradeId))!.status, 'proposed')

      await cleanupOffers()
    })

    await t.step('scales the lead time down for a short window', async () => {
      // 20 minutes left of a 3h window: 25% of 3h is 45 minutes, so this is
      // inside the proportional lead even though it is nowhere near the 6h cap.
      const { data } = await propose({ expires_at: inHours(3), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceDue(tradeId, 3, 20 / 60)

      await runProcessTrades()
      assertExists(await reminderStamp(tradeId))
      await cleanupOffers()
    })

    await t.step('sends nothing on a window under two hours', async () => {
      // 20 minutes left of a 110-minute window. By the proportional rule alone
      // this WOULD fire (25% of 110 is 27 minutes) -- the floor is the only
      // thing stopping it, which is what makes this worth asserting.
      const { data } = await propose({ expires_at: inHours(2), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceDue(tradeId, 110 / 60, 20 / 60)

      await runProcessTrades()
      assertEquals(await reminderStamp(tradeId), null)

      // Same time left, a window just over the floor: now it fires. Proves the
      // step above was refused for the window and not for the time remaining.
      await forceDue(tradeId, 130 / 60, 20 / 60)
      await runProcessTrades()
      assertExists(await reminderStamp(tradeId))

      await cleanupOffers()
    })

    await t.step('sends nothing for an offer with no clock', async () => {
      const { data } = await propose({})
      const tradeId = data!.trade_offer.id as string

      await runProcessTrades()
      assertEquals(await reminderStamp(tradeId), null)
      await cleanupOffers()
    })

    await t.step('sends nothing for an offer that already lapsed', async () => {
      const { data } = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceLapsed(tradeId)

      // The sweep in this same pass expires it. "Expires soon" about something
      // already gone is the thing being ruled out here.
      await runProcessTrades()
      assertEquals((await readOffer(tradeId))!.status, 'expired')
      assertEquals(await reminderStamp(tradeId), null)
      await cleanupOffers()
    })

    await t.step('nudges again once a counter resets the clock', async () => {
      const { data } = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })
      const tradeId = data!.trade_offer.id as string
      await forceDue(tradeId, 48, 1)

      await runProcessTrades()
      assertExists(await reminderStamp(tradeId))

      const { error } = await invokeFunction(secondClient, 'counter-trade', {
        trade_offer_id: tradeId,
        counter_offered_items: { movies: [], faab: 3 },
        counter_requested_items: { movies: [offeredMovie], faab: 0 },
        expires_at: inHours(72),
        expiry_anchor: 'fixed',
      })
      assertEquals(error, null)

      // The counter is a new offer wearing the old row, so its new window gets
      // its own nudge -- counter_trade clears the stamp for exactly this.
      assertEquals(await reminderStamp(tradeId), null)

      await forceDue(tradeId, 72, 2, { countered: true })
      await runProcessTrades()
      assertExists(await reminderStamp(tradeId))

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
