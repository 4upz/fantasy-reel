/**
 * Integration tests for respond-trade Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction, getServiceClient } from './_setup.ts'

Deno.test({
  name: 'respond-trade',
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
      const result = await invokeFunction(anonClient, 'respond-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
        response: 'accept',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for invalid response type', async () => {
      const result = await invokeFunction(client, 'respond-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
        response: 'maybe',
      })
      assertEquals(result.error, 'Response must be "accept" or "reject"')
    })

    await t.step('returns 404 for non-existent trade offer', async () => {
      const result = await invokeFunction(client, 'respond-trade', {
        trade_offer_id: '00000000-0000-0000-0000-000000000000',
        response: 'accept',
      })
      assertEquals(result.error, 'Trade offer not found')
    })

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when user is not the recipient', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('respond-not-recipient'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // Initiator tries to respond to their own trade
      const result = await invokeFunction(client, 'respond-trade', {
        trade_offer_id: tradeOfferId,
        response: 'accept',
      })
      assertEquals(result.error, 'You can only respond to trades sent to your team')
    })

    // ============================================================================
    // Reject Tests
    // ============================================================================

    await t.step('successfully rejects a trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('respond-reject'))
      const tradeOfferId = await createPendingTrade(leagueId)

      const { data, error } = await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'reject',
          message: 'Not interested, thanks',
        },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Trade rejected')
      assertEquals(data.trade_offer_id, tradeOfferId)

      // Verify the trade status
      const serviceClient = getServiceClient()
      const { data: trade } = await serviceClient
        .from('trade_offers')
        .select('status, response_message')
        .eq('id', tradeOfferId)
        .single()

      assertEquals(trade?.status, 'rejected')
      assertEquals(trade?.response_message, 'Not interested, thanks')
    })

    // ============================================================================
    // Accept Tests
    // ============================================================================

    await t.step('successfully accepts a trade (goes to review)', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('respond-accept'))
      const tradeOfferId = await createPendingTrade(leagueId)

      const { data, error } = await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'accept',
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.status, 'review')
      assertExists(data.trade_offer.accepted_at)
      assertExists(data.trade_offer.review_ends_at)
    })

    await t.step('accepts immediately when review is disabled', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('respond-no-review'))

      // Disable review period
      const serviceClient = getServiceClient()
      await serviceClient
        .from('leagues')
        .update({ trade_review_enabled: false })
        .eq('id', leagueId)

      const tradeOfferId = await createPendingTrade(leagueId)

      const { data, error } = await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'accept',
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.status, 'accepted')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when trade is already rejected', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('respond-already-rejected'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // First rejection
      await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'reject',
        },
      })

      // Try to accept the rejected trade
      const result = await invokeFunction(secondClient, 'respond-trade', {
        trade_offer_id: tradeOfferId,
        response: 'accept',
      })

      assertEquals(result.error, 'Cannot respond to a trade with status "rejected"')
    })

    await t.step('returns 400 when trade is already accepted', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('respond-already-accepted'))
      const tradeOfferId = await createPendingTrade(leagueId)

      // First acceptance
      await secondClient.functions.invoke('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response: 'accept',
        },
      })

      // Try to reject the accepted trade
      const result = await invokeFunction(secondClient, 'respond-trade', {
        trade_offer_id: tradeOfferId,
        response: 'reject',
      })

      assertEquals(result.error, 'Cannot respond to a trade with status "review"')
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
