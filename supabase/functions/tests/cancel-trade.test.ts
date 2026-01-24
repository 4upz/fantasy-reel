/**
 * Integration tests for cancel-trade Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction, getServiceClient } from './_setup.ts'

Deno.test({
  name: 'cancel-trade',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // Helper to create a pending trade offer
    async function createPendingTrade(leagueId: string): Promise<string> {
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
      const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)

      if (!recipientTeam || initiatorPicks.length === 0) {
        throw new Error('Test setup failed')
      }

      const { data, error } = await client.functions.invoke('propose-trade', {
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
          requested_items: { movies: [], faab: 10 },
        },
      })

      if (error || !data.trade_offer) {
        throw new Error(`Failed to create pending trade: ${error?.message || 'unknown error'}`)
      }

      return data.trade_offer.id
    }

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'cancel-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing trade_offer_id', async () => {
      const result = await invokeFunction(client, 'cancel-trade', {})
      assertEquals(result.error, 'Valid trade_offer_id is required')
    })

    await t.step('returns 400 for invalid trade_offer_id', async () => {
      const result = await invokeFunction(client, 'cancel-trade', {
        trade_offer_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid trade_offer_id is required')
    })

    await t.step('returns 404 for non-existent trade offer', async () => {
      const result = await invokeFunction(client, 'cancel-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Trade offer not found')
    })

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when user is not the initiator', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-not-initiator'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Recipient tries to cancel the trade (should use reject instead)
      const result = await invokeFunction(secondClient, 'cancel-trade', {
        trade_offer_id: tradeOfferId,
      })
      assertEquals(result.error, 'You can only cancel trades you initiated')
    })

    await t.step('returns 403 when third party tries to cancel', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-third-party'), 3)
      const tradeOfferId = await createPendingTrade(leagueId)

      // Third user (who joined the league) tries to cancel
      const thirdClient = await factory.createThirdClient()
      const result = await invokeFunction(thirdClient, 'cancel-trade', {
        trade_offer_id: tradeOfferId,
      })
      assertEquals(result.error, 'You can only cancel trades you initiated')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when trade is already cancelled', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-already-cancelled'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // First cancellation
      await client.functions.invoke('cancel-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      // Try to cancel again
      const result = await invokeFunction(client, 'cancel-trade', {
        trade_offer_id: tradeOfferId,
      })
      assertEquals(result.error, 'Cannot cancel a trade with status "cancelled"')
    })

    await t.step('returns 400 when trade is rejected', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-rejected'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Recipient rejects the trade
      await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'reject',
        },
      })

      // Initiator tries to cancel rejected trade
      const result = await invokeFunction(client, 'cancel-trade', {
        trade_offer_id: tradeOfferId,
      })
      assertEquals(result.error, 'Cannot cancel a trade with status "rejected"')
    })

    await t.step('returns 400 when trade is in review', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-in-review'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Recipient accepts the trade (goes to review)
      await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'accept',
        },
      })

      // Initiator tries to cancel trade in review
      const result = await invokeFunction(client, 'cancel-trade', {
        trade_offer_id: tradeOfferId,
      })
      assertEquals(result.error, 'Cannot cancel a trade with status "review"')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully cancels a proposed trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-success'))
      const tradeOfferId = await createPendingTrade(leagueId)

      const { data, error } = await client.functions.invoke('cancel-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Trade cancelled')
      assertEquals(data.trade_offer_id, tradeOfferId)

      // Verify the trade status
      const serviceClient = getServiceClient()
      const { data: trade } = await serviceClient
        .from('trade_offers')
        .select('status')
        .eq('id', tradeOfferId)
        .single()

      assertEquals(trade?.status, 'cancelled')
    })

    await t.step('successfully cancels a countered trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('cancel-countered'))
      const tradeOfferId = await createPendingTrade(leagueId)
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)

      // Recipient counters the trade
      await secondClient.functions.invoke('counter-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          counter_offered_items: {
            movies: [{
              movie_id: recipientPicks[0].movie_id,
              source: 'draft_pick',
              source_id: recipientPicks[0].id,
            }],
            faab: 0,
          },
          counter_requested_items: { movies: [], faab: 5 },
        },
      })

      // Now second client is the initiator, they can cancel
      const { data, error } = await secondClient.functions.invoke('cancel-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Trade cancelled')
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
