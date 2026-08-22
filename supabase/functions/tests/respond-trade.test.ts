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

    // Like createPendingTrade, but also hands back the traded draft_pick/movie/team
    // ids so counterpick guardrail tests can seed a counterpick on the exact item
    // being traded and check where it lands afterward.
    async function createPendingTradeWithPick(leagueId: string): Promise<{
      tradeOfferId: string
      draftPickId: string
      movieId: string
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

      const { data, error } = await client.functions.invoke('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeam.teamId,
          offered_items: {
            movies: [{ movie_id: pick.movie_id, source: 'draft_pick', source_id: pick.id }],
            faab: 0,
          },
          requested_items: { movies: [], faab: 10 },
        },
      })

      if (error || !data.trade_offer) {
        throw new Error(`Failed to create pending trade: ${error?.message || 'unknown error'}`)
      }

      return {
        tradeOfferId: data.trade_offer.id,
        draftPickId: pick.id,
        movieId: pick.movie_id,
        initiatorTeamId: initiatorTeam.teamId,
        recipientTeamId: recipientTeam.teamId,
      }
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
    // Counterpick Trade Guardrail Tests
    // ============================================================================

    await t.step(
      'trade of a movie counterpicked by a third team succeeds and retargets the counterpick',
      async () => {
        const leagueId = await factory.createTradingLeague(uniqueName('respond-counterpick-third'), 3)
        const thirdClient = await factory.createThirdClient()

        const { tradeOfferId, draftPickId, movieId, recipientTeamId } =
          await createPendingTradeWithPick(leagueId)

        // An uninvolved third team counterpicks the movie being traded -- this is
        // allowed (the counterpick is a bet on the movie, not a claim on the holder).
        await factory.addCounterpickToDraftPick(leagueId, draftPickId, thirdClient)

        // Skip the review window so acceptance moves straight to 'accepted'.
        const serviceClient = getServiceClient()
        await serviceClient
          .from('leagues')
          .update({ trade_review_enabled: false })
          .eq('id', leagueId)

        const { data, error } = await secondClient.functions.invoke('respond-trade', {
          body: { trade_offer_id: tradeOfferId, response: 'accept' },
        })

        assertEquals(error, null)
        assertEquals(data.trade_offer.status, 'accepted')

        // respond-trade only advances status; process-trades normally executes
        // 'accepted' trades on its next run. Call execute_trade directly here to
        // isolate the guardrail from cron scheduling.
        const { data: execResult, error: execError } = await serviceClient.rpc('execute_trade', {
          p_trade_id: tradeOfferId,
        })
        assertEquals(execError, null)
        assertEquals(execResult.success, true)

        const { data: draftPick } = await serviceClient
          .from('draft_picks')
          .select('team_id')
          .eq('id', draftPickId)
          .single()
        assertEquals(draftPick?.team_id, recipientTeamId)

        const { data: counterpick } = await serviceClient
          .from('counterpicks')
          .select('target_team_id')
          .eq('league_id', leagueId)
          .eq('movie_id', movieId)
          .single()
        assertEquals(counterpick?.target_team_id, recipientTeamId)
      }
    )

    await t.step(
      'trade sending a movie to its own counterpicker is rejected at acceptance',
      async () => {
        const leagueId = await factory.createTradingLeague(uniqueName('respond-counterpick-self'))

        const { tradeOfferId, draftPickId, initiatorTeamId, movieId, recipientTeamId } =
          await createPendingTradeWithPick(leagueId)

        // The recipient -- who is about to receive this movie -- counterpicks it
        // after the trade was already proposed. Accepting now would hand the
        // movie to its own counterpicker, which the guardrail must block.
        await factory.addCounterpickToDraftPick(leagueId, draftPickId, secondClient)

        const result = await invokeFunction(secondClient, 'respond-trade', {
          trade_offer_id: tradeOfferId,
          response: 'accept',
        })

        // The message is UI copy, so it names the team and the movie rather
        // than the draft_pick id it used to quote.
        const lookupClient = getServiceClient()
        const { data: recipientTeam } = await lookupClient
          .from('teams')
          .select('name')
          .eq('id', recipientTeamId)
          .single()
        const { data: movie } = await lookupClient
          .from('movies')
          .select('title')
          .eq('id', movieId)
          .single()

        assertEquals(
          result.error,
          `Trade can no longer be accepted: ${recipientTeam?.name} holds the counterpick on "${movie?.title}", so they can't also hold the movie.`
        )

        // Nothing moved: the draft pick is still with the initiator and the trade is still pending.
        const serviceClient = getServiceClient()
        const { data: draftPick } = await serviceClient
          .from('draft_picks')
          .select('team_id')
          .eq('id', draftPickId)
          .single()
        assertEquals(draftPick?.team_id, initiatorTeamId)

        const { data: trade } = await serviceClient
          .from('trade_offers')
          .select('status')
          .eq('id', tradeOfferId)
          .single()
        assertEquals(trade?.status, 'proposed')
      }
    )

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
