/**
 * Integration tests for propose-trade Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'propose-trade',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'propose-trade', {
        league_id: '00000000-0000-0000-0000-000000000000',
        recipient_team_id: '00000000-0000-0000-0000-000000000001',
        offered_items: { movies: [], faab: 0 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing league_id', async () => {
      const result = await invokeFunction(client, 'propose-trade', {
        recipient_team_id: '00000000-0000-0000-0000-000000000001',
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for invalid league_id', async () => {
      const result = await invokeFunction(client, 'propose-trade', {
        league_id: 'not-a-uuid',
        recipient_team_id: '00000000-0000-0000-0000-000000000001',
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for missing recipient_team_id', async () => {
      const result = await invokeFunction(client, 'propose-trade', {
        league_id: '00000000-0000-0000-0000-000000000000',
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Valid recipient_team_id is required')
    })

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when user is not a league participant', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-not-member'))
      const thirdClient = await factory.createThirdClient()

      // Get recipient team (second user's team)
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      const result = await invokeFunction(thirdClient, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam?.teamId,
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'You are not an active participant in this league')
    })

    await t.step('returns 400 when trying to trade with yourself', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-self'))

      // Get initiator's own team
      const ownTeam = await factory.getTeamForUser(leagueId, client)

      const result = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: ownTeam?.teamId,
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Cannot propose a trade with yourself')
    })

    // ============================================================================
    // Trade Status Tests
    // ============================================================================

    await t.step('returns 400 when league is not active', async () => {
      // Create a league in setup status
      const { id: leagueId } = await factory.createLeague(uniqueName('trade-setup'))

      const result = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: '00000000-0000-0000-0000-000000000001',
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'You are not an active participant in this league')
    })

    await t.step('returns 400 when trading is not enabled', async () => {
      // Create an active league without trading enabled
      const leagueId = await factory.createActiveLeague(uniqueName('trade-disabled'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      const result = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam?.teamId,
        offered_items: { movies: [], faab: 10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Trading is not enabled for this league')
    })

    // ============================================================================
    // Item Validation Tests
    // ============================================================================

    await t.step('returns 400 when trade is empty (no items)', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-empty'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      const result = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam?.teamId,
        offered_items: { movies: [], faab: 0 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'Trade must include at least one item')
    })

    await t.step('returns 400 for invalid FAAB amount (negative)', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-neg-faab'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      const result = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam?.teamId,
        offered_items: { movies: [], faab: -10 },
        requested_items: { movies: [], faab: 0 },
      })
      assertEquals(result.error, 'FAAB must be a number between 0 and 100')
    })

    await t.step('returns 400 when offering more FAAB than available', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-over-faab'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      // Default budget is 100, try to offer 101
      const result = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipientTeam?.teamId,
        offered_items: { movies: [], faab: 101 },
        requested_items: { movies: [], faab: 0 },
      })
      // Validation happens first on structure (0-100)
      assertEquals(result.error, 'FAAB must be a number between 0 and 100')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully proposes FAAB-only trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-faab-success'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      const { data, error } = await client.functions.invoke('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeam?.teamId,
          offered_items: { movies: [], faab: 15 },
          requested_items: { movies: [], faab: 0 },
          message: 'Free FAAB for you!',
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.league_id, leagueId)
      assertEquals(data.trade_offer.recipient_team_id, recipientTeam?.teamId)
      assertEquals(data.trade_offer.status, 'proposed')
      assertEquals(data.trade_offer.initiator_items.faab, 15)
      assertEquals(data.trade_offer.initiator_message, 'Free FAAB for you!')
      assertEquals(data.message, 'Trade proposal submitted successfully')
    })

    await t.step('successfully proposes movie trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-movie-success'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)

      // Get initiator's draft picks
      const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)
      const recipientPicks = await factory.getDraftPicksForUser(leagueId, secondClient)

      if (initiatorPicks.length === 0 || recipientPicks.length === 0) {
        throw new Error('Test setup failed: no draft picks found')
      }

      const { data, error } = await client.functions.invoke('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeam?.teamId,
          offered_items: {
            movies: [{
              movie_id: initiatorPicks[0].movie_id,
              source: 'draft_pick',
              source_id: initiatorPicks[0].id,
            }],
            faab: 0,
          },
          requested_items: {
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
      assertEquals(data.trade_offer.status, 'proposed')
      assertEquals(data.trade_offer.initiator_items.movies.length, 1)
      assertEquals(data.trade_offer.recipient_items.movies.length, 1)
    })

    await t.step('successfully proposes movie + FAAB trade', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('trade-combo-success'))
      const recipientTeam = await factory.getTeamForUser(leagueId, secondClient)
      const initiatorPicks = await factory.getDraftPicksForUser(leagueId, client)

      if (initiatorPicks.length === 0) {
        throw new Error('Test setup failed: no draft picks found')
      }

      const { data, error } = await client.functions.invoke('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeam?.teamId,
          offered_items: {
            movies: [{
              movie_id: initiatorPicks[0].movie_id,
              source: 'draft_pick',
              source_id: initiatorPicks[0].id,
            }],
            faab: 10,
          },
          requested_items: { movies: [], faab: 20 },
        },
      })

      assertEquals(error, null)
      assertExists(data.trade_offer)
      assertEquals(data.trade_offer.initiator_items.movies.length, 1)
      assertEquals(data.trade_offer.initiator_items.faab, 10)
      assertEquals(data.trade_offer.recipient_items.faab, 20)
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
