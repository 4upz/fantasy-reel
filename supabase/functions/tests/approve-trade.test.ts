/**
 * Integration tests for approve-trade Edge Function
 *
 * approve-trade is the commissioner counterpart to veto-trade: before it, a
 * trade both teams had agreed to could only be vetoed or waited out until
 * review_ends_at (default 24h) let the process-trades cron execute it. These
 * tests pin the two halves of that: the commissioner-only authorization, and
 * that approving actually MOVES the holdings there and then rather than just
 * re-scheduling them.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction, getServiceClient } from './_setup.ts'

Deno.test({
  name: 'approve-trade',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    /**
     * Propose a one-movie trade from the primary user's team (also the league
     * commissioner) to the second user's team, and have the recipient accept
     * it, which parks it in 'review'.
     */
    async function createTradeInReview(leagueId: string): Promise<{
      tradeOfferId: string
      draftPickId: string
      initiatorTeamId: string
      recipientTeamId: string
    }> {
      const initiatorTeam = await factory.getTeamForUser(leagueId, client)
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
      const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)

      if (!initiatorTeam || !recipientTeam || initiatorPicks.length === 0) {
        throw new Error('Test setup failed')
      }

      const pick = initiatorPicks[0]

      const { data: proposed, error: proposeError } = await client.functions.invoke('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeam.teamId,
          offered_items: {
            movies: [{ movie_id: pick.movie_id, source: 'draft_pick', source_id: pick.id }],
            faab: 0,
          },
          requested_items: { movies: [], faab: 0 },
        },
      })

      if (proposeError || !proposed?.trade_offer) {
        throw new Error(`Failed to propose trade: ${proposeError?.message ?? 'unknown error'}`)
      }

      const acceptResult = await invokeFunction(secondClient, 'respond-trade', {
        trade_offer_id: proposed.trade_offer.id,
        response: 'accept',
      })

      if (acceptResult.error) {
        throw new Error(`Failed to accept trade: ${acceptResult.error}`)
      }

      return {
        tradeOfferId: proposed.trade_offer.id,
        draftPickId: pick.id,
        initiatorTeamId: initiatorTeam.teamId,
        recipientTeamId: recipientTeam.teamId,
      }
    }

    // ========================================================================
    // Authentication & validation
    // ========================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const result = await invokeFunction(getAnonClient(), 'approve-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for an invalid trade_offer_id', async () => {
      const result = await invokeFunction(client, 'approve-trade', {
        trade_offer_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid trade_offer_id is required')
    })

    await t.step('returns 404 for a non-existent trade offer', async () => {
      const result = await invokeFunction(client, 'approve-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Trade offer not found')
    })

    // ========================================================================
    // Authorization
    // ========================================================================

    await t.step('returns 403 when the user is not the commissioner', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('approve-not-owner'))
      const { tradeOfferId } = await createTradeInReview(leagueId)

      // secondClient is the recipient of the trade but not the league owner --
      // being a party to a trade must not confer commissioner powers over it.
      const result = await invokeFunction(secondClient, 'approve-trade', {
        trade_offer_id: tradeOfferId,
      })

      assertEquals(result.error, 'Only the league commissioner can approve trades')

      const { data: trade } = await serviceClient
        .from('trade_offers')
        .select('status')
        .eq('id', tradeOfferId)
        .single()
      assertEquals(trade?.status, 'review')
    })

    // ========================================================================
    // Status guards
    // ========================================================================

    await t.step('returns 400 for a trade that has not been accepted yet', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('approve-proposed'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
      const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)
      assertExists(recipientTeam)

      const { data: proposed } = await client.functions.invoke('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeam.teamId,
          offered_items: {
            movies: [{
              movie_id: initiatorPicks[0].movie_id,
              source: 'draft_pick',
              source_id: initiatorPicks[0].id,
            }],
            faab: 0,
          },
          requested_items: { movies: [], faab: 0 },
        },
      })

      const result = await invokeFunction(client, 'approve-trade', {
        trade_offer_id: proposed.trade_offer.id,
      })

      assertEquals(
        result.error,
        'Cannot approve a trade with status "proposed". Only a trade both teams have agreed to can be approved.'
      )
    })

    // ========================================================================
    // Success path -- the whole point: it executes NOW
    // ========================================================================

    await t.step('commissioner approval executes the trade immediately', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('approve-success'))
      const { tradeOfferId, draftPickId, recipientTeamId } = await createTradeInReview(leagueId)

      // Precondition: still in review, deadline in the future, holding unmoved.
      const { data: before } = await serviceClient
        .from('trade_offers')
        .select('status, review_ends_at, approved_by')
        .eq('id', tradeOfferId)
        .single()
      assertEquals(before?.status, 'review')
      assertEquals(before?.approved_by, null)
      assertEquals(new Date(before!.review_ends_at as string) > new Date(), true)

      const { data, error } = await client.functions.invoke('approve-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Trade approved and processed')

      // No cron run in between -- the trade is done by the time this returns.
      const { data: after } = await serviceClient
        .from('trade_offers')
        .select('status, completed_at, approved_by, review_ends_at')
        .eq('id', tradeOfferId)
        .single()

      assertEquals(after?.status, 'completed')
      assertExists(after?.completed_at)
      assertExists(after?.approved_by)
      // The review window is closed out rather than left pointing at a future
      // deadline on an already-completed trade.
      assertEquals(new Date(after!.review_ends_at as string) <= new Date(), true)

      // And the holding actually changed hands.
      const { data: movedPick } = await serviceClient
        .from('draft_picks')
        .select('team_id')
        .eq('id', draftPickId)
        .single()
      assertEquals(movedPick?.team_id, recipientTeamId)
    })

    await t.step('returns 400 when the trade has already been processed', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('approve-twice'))
      const { tradeOfferId } = await createTradeInReview(leagueId)

      const first = await invokeFunction(client, 'approve-trade', { trade_offer_id: tradeOfferId })
      assertEquals(first.error, null)

      const second = await invokeFunction(client, 'approve-trade', { trade_offer_id: tradeOfferId })
      assertEquals(
        second.error,
        'Cannot approve a trade with status "completed". Only a trade both teams have agreed to can be approved.'
      )
    })

    await t.step('a vetoed trade can no longer be approved', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('approve-after-veto'))
      const { tradeOfferId } = await createTradeInReview(leagueId)

      const vetoResult = await invokeFunction(client, 'veto-trade', {
        trade_offer_id: tradeOfferId,
        reason: 'Too lopsided',
      })
      assertEquals(vetoResult.error, null)

      const result = await invokeFunction(client, 'approve-trade', { trade_offer_id: tradeOfferId })
      assertEquals(
        result.error,
        'Cannot approve a trade with status "vetoed". Only a trade both teams have agreed to can be approved.'
      )
    })

    // ========================================================================
    // Leagues without a review period
    // ========================================================================

    await t.step('approves an accepted trade in a league with review disabled', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('approve-no-review'))
      await serviceClient
        .from('leagues')
        .update({ trade_review_enabled: false })
        .eq('id', leagueId)

      // Without a review period respond-trade parks the trade in 'accepted',
      // waiting on the cron. The commissioner can still push it through.
      const { tradeOfferId, draftPickId, recipientTeamId } = await createTradeInReview(leagueId)

      const { data: accepted } = await serviceClient
        .from('trade_offers')
        .select('status')
        .eq('id', tradeOfferId)
        .single()
      assertEquals(accepted?.status, 'accepted')

      const result = await invokeFunction(client, 'approve-trade', { trade_offer_id: tradeOfferId })
      assertEquals(result.error, null)

      const { data: movedPick } = await serviceClient
        .from('draft_picks')
        .select('team_id')
        .eq('id', draftPickId)
        .single()
      assertEquals(movedPick?.team_id, recipientTeamId)
    })

    await factory.cleanup()
  },
})
