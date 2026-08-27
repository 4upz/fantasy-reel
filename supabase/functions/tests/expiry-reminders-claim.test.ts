/**
 * Integration tests for claim_expiry_reminders(), the predicate behind the
 * "expiring soon" nudge.
 *
 * Defined in 20260825120000_expiry_reminders.sql and redefined in
 * 20260827120000_league_trade_expiry_config.sql, which folds the league's own
 * trade_offer_expiry_min_hours into the window floor.
 *
 * WHY THIS FILE EXISTS ALONGSIDE trade-expiry.test.ts. That file drives the
 * nudge through the process-trades cron, which proves the wiring: the cron
 * calls the function, the returned rows get emailed, the stamp survives a
 * second pass. It cannot reach the predicate's edges, because the cron passes
 * the production parameters and nothing else. Every threshold there is
 * therefore expressed in hours, and every case sits comfortably inside or
 * outside its range -- which is exactly the shape of test that let a bug ship
 * in this same PR unnoticed. This file calls the function DIRECTLY with
 * explicit parameters, so a boundary can be stated in seconds and the two
 * halves of the LEAST() can be told apart.
 *
 * Everything here goes through getServiceClient(), so the edge runtime is not
 * involved at all -- only Postgres and PostgREST. That is deliberate: a
 * DB-layer guarantee should be tested at the DB layer, where a wedged or
 * stale-code function container cannot turn a real regression into a
 * mysterious timeout.
 *
 * ONE THING TO KNOW BEFORE ADDING STEPS. claim_expiry_reminders() has no
 * league parameter: it claims across the whole table. So a claim here will
 * stamp any other league's due offer that happens to be sitting in the
 * database, and another file's process-trades run will stamp ours. Both are
 * only safe because `deno test tests/` runs files sequentially and every step
 * below deletes its own offers before the next one starts. Every assertion is
 * still written against this file's own offer ids rather than against row
 * counts, so a stray row from elsewhere cannot make a step pass or fail by
 * accident.
 *
 * Requires: npx supabase start  (no `functions serve` -- nothing here calls one)
 */

import { assertEquals, assertExists, assert } from '@std/assert'
import { createTestFactory, getServiceClient, uniqueName } from './_setup.ts'

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/**
 * The production parameters, spelled out rather than left to the function's
 * defaults, so a step can be read without going to look them up.
 */
const PROD = { p_lead: '6 hours', p_min_window: '2 hours', p_fraction: 0.25 }

/**
 * How far outside a threshold a "just outside" case is placed.
 *
 * It cannot be zero. Two of the three inputs to the lead-time rule are stored
 * columns, but the third is now(), evaluated inside the function -- so between
 * this file writing expires_at and the UPDATE reading it, the remaining time
 * has already shrunk by one insert plus one RPC round trip. Against a local
 * Postgres that is tens of milliseconds; two minutes is three orders of
 * magnitude of headroom and still only ~1.7% outside the 2h threshold the
 * boundary steps use, which is far tighter than any plausible wrong
 * implementation of min(p_lead, window x p_fraction).
 *
 * The same drift is why an exactly-at-the-threshold case can only prove the
 * comparison is not strictly-greater-than in the wrong direction -- it lands a
 * hair INSIDE by the time the function sees it. The floor's `>=` is the
 * boundary that can be pinned exactly, because both of its operands are stored
 * columns and now() plays no part; see the min-window steps below.
 */
const EPSILON_MS = 2 * MINUTE_MS

Deno.test({
  name: 'claim_expiry_reminders',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    const leagueId = await factory.createTradingLeague(uniqueName('Reminder Claim League'))
    const initiatorTeam = await factory.getTeamForUser(leagueId, client)
    const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
    assertExists(initiatorTeam)
    assertExists(recipientTeam)

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Insert an offer with exactly the clock columns given.
     *
     * Written straight to the table rather than proposed through the Edge
     * Function: propose-trade will not create an offer that started two days
     * ago, or one already past its clock, or one whose window is a second
     * under the league minimum -- and those are the rows this file is about.
     */
    async function insertOffer(fields: Record<string, unknown> = {}): Promise<string> {
      const { data, error } = await serviceClient
        .from('trade_offers')
        .insert({
          league_id: leagueId,
          initiator_team_id: initiatorTeam!.teamId,
          recipient_team_id: recipientTeam!.teamId,
          // check_has_items needs something on the table. A token FAAB is the
          // cheapest thing that satisfies it, and this predicate never looks
          // at what is being traded.
          initiator_items: { movies: [], faab: 1 },
          recipient_items: { movies: [], faab: 0 },
          status: 'proposed',
          ...fields,
        })
        .select('id')
        .single()
      assertEquals(error, null, `failed to insert test offer: ${error?.message}`)
      return data!.id as string
    }

    /**
     * Clock columns for an offer `remainingMs` from lapsing, on a window that
     * has been `windowMs` long since it started.
     *
     * `countered: true` puts the window start in responded_at as well as
     * proposed_at, which is what counter_trade() does when it reuses the row --
     * the predicate measures from COALESCE(responded_at, proposed_at).
     */
    function clock(
      windowMs: number,
      remainingMs: number,
      options: { countered?: boolean } = {},
    ): Record<string, unknown> {
      const expiresAt = new Date(Date.now() + remainingMs)
      const start = new Date(expiresAt.getTime() - windowMs).toISOString()
      return {
        proposed_at: start,
        expires_at: expiresAt.toISOString(),
        expiry_anchor: 'fixed',
        ...(options.countered ? { responded_at: start, status: 'countered' } : {}),
      }
    }

    /** Run the claim and return just the ids it took. */
    async function claim(params: Record<string, unknown> = PROD): Promise<string[]> {
      const { data, error } = await serviceClient.rpc('claim_expiry_reminders', params)
      assertEquals(error, null, `claim_expiry_reminders failed: ${JSON.stringify(error)}`)
      return (data as Array<{ id: string }>).map((row) => row.id)
    }

    async function reminderStamp(tradeId: string): Promise<string | null> {
      const { data } = await serviceClient
        .from('trade_offers')
        .select('expiry_reminder_sent_at')
        .eq('id', tradeId)
        .single()
      return (data?.expiry_reminder_sent_at as string | null) ?? null
    }

    async function cleanupOffers() {
      await serviceClient.from('trade_offers').delete().eq('league_id', leagueId)
    }

    async function setLeagueMinHours(hours: number | null) {
      const { error } = await serviceClient
        .from('leagues')
        .update({ trade_offer_expiry_min_hours: hours })
        .eq('id', leagueId)
      assertEquals(error, null, `failed to set league minimum: ${error?.message}`)
    }

    // ========================================================================
    // The lead-time rule: remaining <= LEAST(p_lead, window x p_fraction)
    //
    // Two branches, and a test that only ever exercises one of them will not
    // notice the other being wrong. Each pair below fires on one side of the
    // LEAST and is refused on the other, with the OTHER branch deliberately
    // satisfied -- so the assertion is about which branch won, not about
    // whether anything fires at all.
    // ========================================================================

    await t.step('on a long window the p_lead ceiling is what governs', async (t) => {
      // 48h window: 25% of it is 12h, so p_lead's 6h is the smaller of the two
      // and therefore the operative threshold.

      await t.step('5h remaining is inside the 6h ceiling', async () => {
        const id = await insertOffer(clock(48 * HOUR_MS, 5 * HOUR_MS))
        assert((await claim()).includes(id), 'offer inside the p_lead ceiling was not claimed')
        assertExists(await reminderStamp(id), 'claimed row was returned but not stamped')
        await cleanupOffers()
      })

      await t.step('8h remaining is outside it, even though 25% of the window is 12h', async () => {
        // The whole point of this step: by the proportional half alone this
        // offer is due. Only the ceiling holds it back.
        const id = await insertOffer(clock(48 * HOUR_MS, 8 * HOUR_MS))
        assert(!(await claim()).includes(id), 'p_lead ceiling did not cap the proportional lead')
        assertEquals(await reminderStamp(id), null)
        await cleanupOffers()
      })
    })

    await t.step('on a short window the fraction is what governs', async (t) => {
      // 4h window: 25% is 1h, which is now the smaller of the two. Both cases
      // sit well inside p_lead's 6h, so p_lead cannot be the one deciding.

      await t.step('45m remaining is inside the 1h proportional lead', async () => {
        const id = await insertOffer(clock(4 * HOUR_MS, 45 * MINUTE_MS))
        assert((await claim()).includes(id), 'offer inside the proportional lead was not claimed')
        await cleanupOffers()
      })

      await t.step('2h remaining is outside it, though far inside the 6h ceiling', async () => {
        // A nudge here would mean the lead never scales down, which is the
        // failure the 25% rule exists to prevent: warning about a 4h offer
        // 6h ahead of time would mean warning before it was made.
        const id = await insertOffer(clock(4 * HOUR_MS, 2 * HOUR_MS))
        assert(!(await claim()).includes(id), 'the lead time did not scale down for a short window')
        await cleanupOffers()
      })
    })

    // ========================================================================
    // Boundary precision
    //
    // Every case above is comfortably inside or outside its threshold, which
    // is the shape of coverage that hides an arithmetic slip. These steps sit
    // on the line.
    // ========================================================================

    await t.step('the proportional threshold holds to within two minutes', async (t) => {
      // 8h window, 25% of it: the line is at exactly 2h remaining.

      await t.step('exactly at the threshold, it fires', async () => {
        // Strictly this lands a hair inside rather than exactly on the line --
        // now() advances between the insert and the claim. What it does rule
        // out is a threshold computed even slightly short of window x
        // p_fraction, which would refuse this row.
        const id = await insertOffer(clock(8 * HOUR_MS, 2 * HOUR_MS))
        assert((await claim()).includes(id), 'an offer exactly at the threshold was not claimed')
        await cleanupOffers()
      })

      await t.step('two minutes outside it, it does not', async () => {
        const id = await insertOffer(clock(8 * HOUR_MS, 2 * HOUR_MS + EPSILON_MS))
        assert(
          !(await claim()).includes(id),
          'an offer past the threshold was claimed -- the lead time is too generous',
        )
        assertEquals(await reminderStamp(id), null)
        await cleanupOffers()
      })
    })

    await t.step('the p_lead ceiling holds to within two minutes', async (t) => {
      // 48h window again, so the fraction (12h) is nowhere near: the line is
      // p_lead itself, at exactly 6h remaining.

      await t.step('exactly at the ceiling, it fires', async () => {
        const id = await insertOffer(clock(48 * HOUR_MS, 6 * HOUR_MS))
        assert((await claim()).includes(id), 'an offer exactly at p_lead was not claimed')
        await cleanupOffers()
      })

      await t.step('two minutes outside it, it does not', async () => {
        const id = await insertOffer(clock(48 * HOUR_MS, 6 * HOUR_MS + EPSILON_MS))
        assert(!(await claim()).includes(id), 'an offer past p_lead was claimed')
        await cleanupOffers()
      })
    })

    // ========================================================================
    // The window floor: window >= GREATEST(p_min_window, league minimum)
    //
    // This is the one boundary that can be pinned EXACTLY. Both operands are
    // stored columns -- expires_at minus COALESCE(responded_at, proposed_at),
    // against a parameter -- so now() never enters and the comparison can be
    // probed a single second either side of the line.
    // ========================================================================

    await t.step('a window exactly at the floor still qualifies', async () => {
      // 2h window, 15m remaining: inside the proportional lead (25% of 2h is
      // 30m), so the floor is the only clause with anything left to say.
      const id = await insertOffer(clock(2 * HOUR_MS, 15 * MINUTE_MS))
      assert(
        (await claim()).includes(id),
        'a window exactly at p_min_window was refused -- the floor is > where it should be >=',
      )
      await cleanupOffers()
    })

    await t.step('a window one second under the floor does not', async () => {
      const id = await insertOffer(clock(2 * HOUR_MS - 1000, 15 * MINUTE_MS))
      assert(
        !(await claim()).includes(id),
        'a window under p_min_window was claimed -- the floor is not being applied',
      )
      assertEquals(await reminderStamp(id), null)
      await cleanupOffers()
    })

    await t.step('a window well under the floor gets nothing', async () => {
      // 1h window, 10m remaining. 25% of 1h is 15m, so the lead-time rule says
      // yes and the floor is what refuses it. Without that the recipient gets a
      // second ping minutes after the email announcing the offer.
      const id = await insertOffer(clock(1 * HOUR_MS, 10 * MINUTE_MS))
      assert(!(await claim()).includes(id), 'a sub-floor window was nudged')
      await cleanupOffers()
    })

    // ========================================================================
    // ...and the league's own minimum can raise it (20260827120000)
    // ========================================================================

    await t.step('a league minimum above p_min_window suppresses a window that would otherwise qualify', async () => {
      // 4h window, 45m remaining: claimed under the app floor alone, as the
      // short-window step above already showed with these very numbers.
      const id = await insertOffer(clock(4 * HOUR_MS, 45 * MINUTE_MS))

      await setLeagueMinHours(6)
      assert(
        !(await claim()).includes(id),
        "the league's own minimum did not raise the nudge floor",
      )
      assertEquals(await reminderStamp(id), null)

      // The A/B that makes the assertion above mean something: nothing changes
      // but the league row, and the same offer is claimed.
      await setLeagueMinHours(null)
      assert((await claim()).includes(id), 'clearing the league minimum did not restore the nudge')

      await cleanupOffers()
    })

    await t.step('a league minimum below p_min_window leaves the floor at p_min_window', async () => {
      // GREATEST, not replacement. A league that permits 1h offers does not
      // thereby get nudges on 90-minute windows -- the app floor still holds,
      // and the migration comment is explicit that this is the accepted cost.
      await setLeagueMinHours(1)

      // 90m window, 15m remaining. 25% of 90m is 22.5m, so the lead-time rule
      // is satisfied and only the floor is in play.
      const suppressed = await insertOffer(clock(90 * MINUTE_MS, 15 * MINUTE_MS))
      assert(
        !(await claim()).includes(suppressed),
        'a 1h league minimum lowered the floor under p_min_window',
      )

      // Same league, same time remaining, a window that clears 2h: fires. So
      // the refusal above was about the window length and not about the league
      // configuration switching the nudge off wholesale.
      const claimed = await insertOffer(clock(2 * HOUR_MS, 15 * MINUTE_MS))
      assert((await claim()).includes(claimed), 'a window at p_min_window was refused')

      await setLeagueMinHours(null)
      await cleanupOffers()
    })

    // ========================================================================
    // Where the window starts: COALESCE(responded_at, proposed_at)
    // ========================================================================

    await t.step('a countered offer\'s window is measured from the counter, not the proposal', async () => {
      // Both rows lapse at the same instant and were both proposed ten days
      // ago. The only difference is responded_at.
      const proposedAt = new Date(Date.now() - 10 * 24 * HOUR_MS).toISOString()
      const expiresAt = new Date(Date.now() + 5 * HOUR_MS).toISOString()

      // Measured from proposed_at the window is ten days, so the threshold is
      // the 6h ceiling and 5h remaining is inside it.
      const fromProposal = await insertOffer({
        proposed_at: proposedAt,
        expires_at: expiresAt,
        expiry_anchor: 'fixed',
      })

      // Measured from responded_at the window is 8h, so the threshold is 2h and
      // 5h remaining is well outside. If the predicate reached past the counter
      // to proposed_at, this row would be claimed exactly like the one above --
      // which is the bug the COALESCE exists to prevent, since for a countered
      // offer proposed_at belongs to a deal that no longer exists.
      const fromCounter = await insertOffer({
        status: 'countered',
        proposed_at: proposedAt,
        responded_at: new Date(Date.now() - 3 * HOUR_MS).toISOString(),
        expires_at: expiresAt,
        expiry_anchor: 'fixed',
      })

      const claimed = await claim()
      assert(claimed.includes(fromProposal), 'the proposed offer was not claimed')
      assert(
        !claimed.includes(fromCounter),
        'the countered offer was measured from proposed_at instead of responded_at',
      )

      // Only this direction is constructible, and it is worth saying why so
      // the missing mirror does not look like an oversight. Making the
      // countered row fire where the proposed one would NOT needs the window
      // measured from the counter to yield a larger threshold -- but
      // responded_at is always at or after proposed_at, so its window is always
      // the shorter of the two and its proportional threshold always the
      // smaller. The floor cannot supply the asymmetry either: the longer
      // window clears every floor the shorter one clears.

      await cleanupOffers()
    })

    // ========================================================================
    // Exclusions
    // ========================================================================

    await t.step('an offer already stamped is not claimed again', async () => {
      // The stamp is set to an hour ago, so a re-claim would be visible as a
      // changed value rather than having to be inferred from the return set.
      const stampedAt = new Date(Date.now() - HOUR_MS).toISOString()
      const id = await insertOffer({
        ...clock(48 * HOUR_MS, HOUR_MS),
        expiry_reminder_sent_at: stampedAt,
      })

      assert(!(await claim()).includes(id), 'an already-nudged offer was claimed a second time')
      assertEquals(
        new Date((await reminderStamp(id))!).getTime(),
        new Date(stampedAt).getTime(),
        'the existing stamp was overwritten',
      )
      await cleanupOffers()
    })

    await t.step('an offer that has already lapsed is not claimed', async () => {
      // Everything else about this row says nudge it: a 48h window, and a
      // negative remaining time trivially satisfies the lead-time comparison.
      // `expires_at > now()` is the only clause standing between the recipient
      // and being told an offer is "expiring soon" after it is already gone --
      // the sweep in the same cron pass is about to expire it.
      const id = await insertOffer(clock(48 * HOUR_MS, -MINUTE_MS))
      assert(!(await claim()).includes(id), 'a lapsed offer was nudged')
      assertEquals(await reminderStamp(id), null)
      await cleanupOffers()
    })

    await t.step('an offer with no clock is not claimed', async () => {
      // check_expiry_anchor_paired means no expires_at implies no anchor.
      const id = await insertOffer({ expires_at: null, expiry_anchor: null })
      assert(!(await claim()).includes(id), 'an offer with no expiry was nudged')
      assertEquals(await reminderStamp(id), null)
      await cleanupOffers()
    })

    await t.step('only proposed and countered offers are claimed', async () => {
      // Once both parties agree, review_ends_at owns the trade and expires_at
      // is a leftover; the settled statuses have no live clock at all. Every
      // row here carries an identically due clock, so status is the only
      // variable.
      const open = ['proposed', 'countered']
      const settled = ['accepted', 'review', 'completed', 'rejected', 'cancelled', 'vetoed', 'expired']

      const ids = new Map<string, string>()
      for (const status of [...open, ...settled]) {
        ids.set(status, await insertOffer({ status, ...clock(48 * HOUR_MS, HOUR_MS) }))
      }

      const claimed = await claim()
      for (const status of open) {
        assert(claimed.includes(ids.get(status)!), `a due ${status} offer was not claimed`)
      }
      for (const status of settled) {
        assert(!claimed.includes(ids.get(status)!), `a ${status} offer was nudged`)
      }

      await cleanupOffers()
    })

    // ========================================================================
    // The double-claim guarantee
    //
    // This is the property the whole claim-and-stamp design exists to provide,
    // and the reason the predicate and the UPDATE live in one statement rather
    // than being split into a SELECT, a decision in TypeScript, and a write.
    // Split them and two overlapping cron runs both read
    // expiry_reminder_sent_at IS NULL before either writes, and the recipient
    // gets the same nudge twice.
    //
    // Under READ COMMITTED the second UPDATE blocks on the first's row lock,
    // then re-evaluates its WHERE against the committed row -- which by then
    // carries a stamp -- and skips it. So the row can be returned by one call
    // or the other, never both.
    // ========================================================================

    await t.step('two concurrent claims never return the same offer', async () => {
      // Several rows rather than one: a single row could land in the first call
      // by luck in an implementation with no interlock at all, and the step
      // would pass for the wrong reason.
      const ids: string[] = []
      for (let i = 0; i < 6; i++) {
        ids.push(await insertOffer(clock(48 * HOUR_MS, HOUR_MS)))
      }

      const [first, second] = await Promise.all([claim(), claim()])

      for (const id of ids) {
        const appearances = [first, second].filter((result) => result.includes(id)).length
        assertEquals(
          appearances,
          1,
          appearances === 0
            ? `offer ${id} was due but neither concurrent claim took it`
            : `offer ${id} was claimed by BOTH calls -- it would be nudged twice`,
        )
        assertExists(await reminderStamp(id), `offer ${id} was claimed but not stamped`)
      }

      // A third pass, once the dust has settled, finds nothing left.
      const third = await claim()
      for (const id of ids) {
        assert(!third.includes(id), `offer ${id} was claimable again after being claimed`)
      }

      await cleanupOffers()
    })

    // ========================================================================
    // The defaults
    //
    // Every step above passes its parameters explicitly, which is what makes
    // the boundaries expressible -- but it also means none of them would
    // notice a default drifting away from the production policy. process-trades
    // relies on 6h / 2h / 0.25 being what an unparameterized call means.
    // ========================================================================

    await t.step('called with no arguments, the defaults are 6h / 2h / 0.25', async (t) => {
      await t.step('1h remaining on a 48h window is claimed', async () => {
        const id = await insertOffer(clock(48 * HOUR_MS, HOUR_MS))
        assert((await claim({})).includes(id), 'the default p_lead is not 6 hours or longer')
        await cleanupOffers()
      })

      await t.step('8h remaining on a 48h window is not', async () => {
        // Pins the default lead from the other side: 8h is outside a 6h
        // ceiling but inside 25% of the window, so a larger default would show.
        const id = await insertOffer(clock(48 * HOUR_MS, 8 * HOUR_MS))
        assert(!(await claim({})).includes(id), 'the default p_lead is longer than 6 hours')
        await cleanupOffers()
      })

      await t.step('a 90-minute window is not, whatever is left of it', async () => {
        // 15m of a 90m window: inside 25%, under a 2h floor.
        const id = await insertOffer(clock(90 * MINUTE_MS, 15 * MINUTE_MS))
        assert(!(await claim({})).includes(id), 'the default p_min_window is under 2 hours')
        await cleanupOffers()
      })

      await t.step('2h remaining on a 4h window is not', async () => {
        // Pins the default fraction: at 0.25 the threshold is 1h and this is
        // refused; at 0.5 or higher it would be claimed.
        const id = await insertOffer(clock(4 * HOUR_MS, 2 * HOUR_MS))
        assert(!(await claim({})).includes(id), 'the default p_fraction is above 0.25')
        await cleanupOffers()
      })
    })

    await t.step('cleanup test data', async () => {
      await cleanupOffers()
      await factory.cleanup()
    })
  },
})
