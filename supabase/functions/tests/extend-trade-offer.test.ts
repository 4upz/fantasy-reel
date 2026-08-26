/**
 * Integration tests for extend-trade-offer.
 *
 * The proposer may give the recipient more time, and that is the whole of it:
 * not the recipient, not backwards, not past the bounds every other write path
 * is held to. Each of those is a rule someone could otherwise route around by
 * calling the function directly, which is why they are tested here rather than
 * against the button.
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

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function inHours(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString()
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().split('T')[0]
}

/** The instant a movie stops being upcoming: start of the day after release, UTC. */
function releaseBoundary(releaseDate: string): string {
  const [y, m, d] = releaseDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString()
}

/**
 * What the server actually stores for a requested instant: whole minutes, so a
 * window set to exactly one hour never renders as "in 59 minutes".
 */
function wholeMinute(iso: string): string {
  const date = new Date(iso)
  date.setUTCSeconds(0, 0)
  return date.toISOString()
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

Deno.test({
  name: 'extend-trade-offer',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    const leagueId = await factory.createTradingLeague(uniqueName('Extend League'))
    const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
    const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)
    assertExists(recipientTeam)
    assert(initiatorPicks.length > 0, 'test setup: initiator needs at least one holding')

    const offeredMovie = {
      movie_id: initiatorPicks[0].movie_id,
      source: 'draft_pick' as const,
      source_id: initiatorPicks[0].id,
    }

    /** Propose an offer with whatever expiry the step needs, and return its id. */
    async function propose(expiry: Record<string, unknown>): Promise<string> {
      const { data, error } = await invokeFunction<{ trade_offer: Record<string, unknown> }>(
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
      assertEquals(error, null)
      return data!.trade_offer.id as string
    }

    function extend(userClient: typeof client, tradeId: string, expiresAt: string) {
      return invokeFunction<{ trade_offer: Record<string, unknown> }>(
        userClient,
        'extend-trade-offer',
        { trade_offer_id: tradeId, expires_at: expiresAt },
      )
    }

    async function readOffer(tradeId: string) {
      const { data } = await serviceClient
        .from('trade_offers')
        .select('status, expires_at, expiry_anchor, expiry_anchor_movie_id, expiry_reminder_sent_at')
        .eq('id', tradeId)
        .single()
      return data
    }

    /** Force an offer past its clock without letting the sweep see it yet. */
    async function forceLapsed(tradeId: string) {
      const { error } = await serviceClient
        .from('trade_offers')
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', tradeId)
      assertEquals(error, null)
    }

    async function cleanupOffers() {
      await serviceClient.from('trade_offers').delete().eq('league_id', leagueId)
    }

    // ========================================================================
    // The happy path
    // ========================================================================

    await t.step('the proposer can push their own offer out', async () => {
      const tradeId = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })
      // A nudge has already gone out on the old window.
      await serviceClient
        .from('trade_offers')
        .update({ expiry_reminder_sent_at: new Date().toISOString() })
        .eq('id', tradeId)

      const target = inHours(96)
      const { data, error } = await extend(client, tradeId, target)
      assertEquals(error, null)
      assertSameInstant(data!.trade_offer.expires_at, wholeMinute(target))

      const offer = await readOffer(tradeId)
      assertEquals(offer!.status, 'proposed')
      assertSameInstant(offer!.expires_at, wholeMinute(target))
      assertEquals(offer!.expiry_anchor, 'fixed')
      // The window moved, so the nudge that described the old one is owed again.
      assertEquals(offer!.expiry_reminder_sent_at, null)
      await cleanupOffers()
    })

    // ========================================================================
    // Who may extend, and in which direction
    // ========================================================================

    await t.step('the recipient cannot extend the clock they are measured against', async () => {
      const tradeId = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })

      const { error, status } = await extend(secondClient, tradeId, inHours(96))
      assertEquals(status, 403)
      assert(error?.includes('can extend'), `unexpected error: ${error}`)

      // The refusal must not have moved the row.
      const offer = await readOffer(tradeId)
      assert(
        new Date(offer!.expires_at as string).getTime() < Date.now() + 72 * HOUR_MS,
        'the recipient moved the clock',
      )
      await cleanupOffers()
    })

    await t.step('shortening is refused', async () => {
      const tradeId = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })
      const before = (await readOffer(tradeId))!.expires_at

      // Still comfortably above the one-hour minimum, so this is refused for
      // being backwards, not for being too soon.
      const { error, status } = await extend(client, tradeId, inHours(24))
      assertEquals(status, 400)
      assert(error?.includes('never shortened'), `unexpected error: ${error}`)
      assertSameInstant((await readOffer(tradeId))!.expires_at, before as string)
      await cleanupOffers()
    })

    await t.step('an offer with no clock has nothing to extend', async () => {
      const tradeId = await propose({})

      const { error, status } = await extend(client, tradeId, inHours(48))
      assertEquals(status, 400)
      assert(error?.includes('no expiry to extend'), `unexpected error: ${error}`)
      // Giving a standing offer a clock is a shortening, so it stays null.
      assertEquals((await readOffer(tradeId))!.expires_at, null)
      await cleanupOffers()
    })

    // ========================================================================
    // Offers that are past extending
    // ========================================================================

    await t.step('a lapsed offer cannot be revived, even before the sweep runs', async () => {
      const tradeId = await propose({ expires_at: inHours(2), expiry_anchor: 'fixed' })
      await forceLapsed(tradeId)

      const { error, status } = await extend(client, tradeId, inHours(48))
      assertEquals(status, 400)
      assert(error?.includes('expired'), `unexpected error: ${error}`)
      assertEquals((await readOffer(tradeId))!.status, 'proposed')
      await cleanupOffers()
    })

    await t.step('a trade that is no longer open cannot be extended', async () => {
      const tradeId = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })

      const { error: rejectError } = await invokeFunction(secondClient, 'respond-trade', {
        trade_offer_id: tradeId,
        response: 'reject',
      })
      assertEquals(rejectError, null)

      const { error, status } = await extend(client, tradeId, inHours(96))
      assertEquals(status, 400)
      assert(error?.includes('rejected'), `unexpected error: ${error}`)
      await cleanupOffers()
    })

    // ========================================================================
    // The bounds, re-checked here rather than trusted from the proposal
    // ========================================================================

    await t.step('an extension past the maximum window is refused', async () => {
      const tradeId = await propose({ expires_at: inHours(48), expiry_anchor: 'fixed' })

      const { error, status } = await extend(client, tradeId, inHours(30 * 24))
      assertEquals(status, 400)
      assert(error?.includes('longer than'), `unexpected error: ${error}`)
      await cleanupOffers()
    })

    // ========================================================================
    // The release anchor stops being true
    // ========================================================================

    await t.step('extending a movie-anchored offer converts it to a fixed time', async () => {
      // Inside the maximum window, so the extension itself is not what fails.
      const release = isoDate(5)
      await serviceClient
        .from('movies')
        .update({ release_date: release })
        .eq('id', offeredMovie.movie_id)

      const tradeId = await propose({ expiry_anchor: 'movie_release' })
      const anchored = await readOffer(tradeId)
      assertEquals(anchored!.expiry_anchor, 'movie_release')
      assertEquals(anchored!.expiry_anchor_movie_id, offeredMovie.movie_id)
      assertSameInstant(anchored!.expires_at, releaseBoundary(release))

      // Past the release it was waiting on -- which every extension is, since
      // the anchor is where the clock currently sits.
      const target = inHours(8 * 24)
      const { error } = await extend(client, tradeId, target)
      assertEquals(error, null)

      const offer = await readOffer(tradeId)
      assertEquals(offer!.expiry_anchor, 'fixed')
      assertEquals(offer!.expiry_anchor_movie_id, null)
      assertSameInstant(offer!.expires_at, wholeMinute(target))
      await cleanupOffers()
    })

    await t.step('requires authentication', async () => {
      const anonClient = getAnonClient()
      const { status } = await invokeFunction(anonClient, 'extend-trade-offer', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
        expires_at: inHours(48),
      })
      assertEquals(status, 401)
    })
  },
})
