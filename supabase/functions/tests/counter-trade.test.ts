/**
 * Integration tests for counter-trade Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction, getServiceClient } from './_setup.ts'

Deno.test({
  name: 'counter-trade',
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
      const result = await invokeFunction(anonClient, 'counter-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
        counter_offered_items: { movies: [], faab: 5 },
        counter_requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 404 for non-existent trade offer', async () => {
      const result = await invokeFunction(client, 'counter-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
        counter_offered_items: { movies: [], faab: 5 },
        counter_requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Trade offer not found')
    })

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when user is not the recipient', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-not-recipient'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Initiator tries to counter their own trade
      const result = await invokeFunction(client, 'counter-trade', {
        trade_offer_id: tradeOfferId,
        counter_offered_items: { movies: [], faab: 5 },
        counter_requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'You can only counter trades sent to your team')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when trade is rejected', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-rejected'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Reject the trade first
      await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'reject',
        },
      })

      const result = await invokeFunction(secondClient, 'counter-trade', {
        trade_offer_id: tradeOfferId,
        counter_offered_items: { movies: [], faab: 5 },
        counter_requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Cannot counter a trade with status "rejected"')
    })

    await t.step('returns 400 when trade is cancelled', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-cancelled'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Cancel the trade first
      await client.functions.invoke('cancel-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      const result = await invokeFunction(secondClient, 'counter-trade', {
        trade_offer_id: tradeOfferId,
        counter_offered_items: { movies: [], faab: 5 },
        counter_requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Cannot counter a trade with status "cancelled"')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully counters a proposed trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-success'))
      const tradeOfferId = await createPendingTrade(leagueId)
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)

      if (recipientPicks.length === 0) {
        throw new Error('Test setup failed: no recipient picks found')
      }

      const { data, error } = await secondClient.functions.invoke('counter-trade', {
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
          counter_requested_items: { movies: [], faab: 15 },
          message: 'How about this instead?',
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.status, 'countered')
      assertEquals(data.message, 'Counter-offer submitted successfully')

      // Verify roles are swapped
      const serviceClient = getServiceClient()
      const { data: trade } = await serviceClient
        .from('trade_offers')
        .select('initiator_team_id, recipient_team_id')
        .eq('id', tradeOfferId)
        .single()

      const secondTeam = await factory.getTeamForUser(leagueId, secondClient)
      const firstTeam = await factory.getTeamForUser(leagueId, client)

      // After counter, second user becomes initiator
      assertEquals(trade?.initiator_team_id, secondTeam?.teamId)
      assertEquals(trade?.recipient_team_id, firstTeam?.teamId)
    })

    await t.step('successfully counters with budget only', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-budget'))
      const tradeOfferId = await createPendingTrade(leagueId)

      const { data, error } = await secondClient.functions.invoke('counter-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          counter_offered_items: { movies: [], faab: 20 },
          counter_requested_items: { movies: [], faab: 0 },
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.status, 'countered')
      assertEquals(data.trade_offer.initiator_items.faab, 20)
    })

    await t.step('can accept a countered trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-then-accept'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Second user counters
      await secondClient.functions.invoke('counter-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          counter_offered_items: { movies: [], faab: 10 },
          counter_requested_items: { movies: [], faab: 0 },
        },
      })

      // First user (now recipient) accepts the counter
      const { data, error } = await client.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'accept',
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.status, 'review')
    })

    await t.step('supports back-and-forth counter offers', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('counter-back-forth'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Get picks for both users
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)
      const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)

      // Second user counters
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

      // First user (now recipient) counters back
      const { data, error } = await client.functions.invoke('counter-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          counter_offered_items: {
            movies: [{
              movie_id: initiatorPicks[1].movie_id, // Different movie
              source: 'draft_pick',
              source_id: initiatorPicks[1].id,
            }],
            faab: 5,
          },
          counter_requested_items: {
            movies: [{
              movie_id: recipientPicks[0].movie_id,
              source: 'draft_pick',
              source_id: recipientPicks[0].id,
            }],
            faab: 0,
          },
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.status, 'countered')
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
