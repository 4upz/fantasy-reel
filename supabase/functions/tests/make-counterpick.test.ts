/**
 * Integration tests for make-counterpick Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  createTestFactory,
  getAnonClient,
  getServiceClient,
  uniqueName,
  invokeFunction,
} from './_setup.ts'

Deno.test({
  name: 'make-counterpick',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'make-counterpick', {
        league_id: '00000000-0000-0000-0000-000000000000',
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing league_id', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for invalid league_id', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: 'not-a-uuid',
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for missing movie_id', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Valid movie_id is required')
    })

    await t.step('returns 400 for invalid movie_id', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: '00000000-0000-0000-0000-000000000000',
        movie_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid movie_id is required')
    })

    // ============================================================================
    // Not Found Tests
    // ============================================================================

    await t.step('returns 404 when league does not exist', async () => {
      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: '00000000-0000-0000-0000-000000000000',
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'League not found')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when draft has not started (setup status)', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('counterpick-setup'))

      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: leagueId,
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Draft has not started yet')
    })

    await t.step('returns 400 when league is in drafting status', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-drafting'))

      const result = await invokeFunction(client, 'make-counterpick', {
        league_id: leagueId,
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Counterpick round has not started yet')
    })

    // ============================================================================
    // Membership Tests
    // ============================================================================

    await t.step('returns 403 when user is not a league member', async () => {
      // Create league with only user 1
      const { id: leagueId } = await factory.createLeague(uniqueName('counterpick-not-member'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status
      await serviceClient.from('leagues').update({ status: 'counterpicking' }).eq('id', leagueId)

      // User 2 tries to counterpick
      const result = await invokeFunction(secondClient, 'make-counterpick', {
        league_id: leagueId,
        movie_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'You are not a member of this league')
    })

    // ============================================================================
    // Turn Validation Tests
    // ============================================================================

    await t.step('returns 403 when it is not your turn in counterpicking phase', async () => {
      // Create a league in counterpicking phase
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-not-turn'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status
      await serviceClient.from('leagues').update({ status: 'counterpicking' }).eq('id', leagueId)

      // Get user 1's pick to try to counterpick (but it's user 2's turn in reverse order)
      const { data: picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .limit(1)

      if (picks && picks.length > 0) {
        // User 1 tries to counterpick but it's user 2's turn (last drafter picks first)
        const result = await invokeFunction(client, 'make-counterpick', {
          league_id: leagueId,
          movie_id: picks[0].movie_id,
        })
        assertEquals(result.error, 'It is not your turn to counterpick')
      }
    })

    // ============================================================================
    // Counterpick Validation Tests
    // ============================================================================

    await t.step('returns 400 when trying to counterpick own movie', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-own'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status
      await serviceClient.from('leagues').update({ status: 'counterpicking' }).eq('id', leagueId)

      // Get user 2's team (they pick first in reverse order)
      const { data: secondUserData } = await secondClient.auth.getUser()
      const { data: participant } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team = participant?.teams as unknown as { id: string }

      // Get user 2's own draft pick
      const { data: ownPicks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team?.id)
        .limit(1)

      if (ownPicks && ownPicks.length > 0) {
        // User 2 tries to counterpick their own movie
        const result = await invokeFunction(secondClient, 'make-counterpick', {
          league_id: leagueId,
          movie_id: ownPicks[0].movie_id,
        })
        assertEquals(result.error, 'Cannot counterpick your own movie')
      }
    })

    await t.step('returns 404 when movie not found in league draft', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-no-movie'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status
      await serviceClient.from('leagues').update({ status: 'counterpicking' }).eq('id', leagueId)

      // Try to counterpick a non-existent movie
      const result = await invokeFunction(secondClient, 'make-counterpick', {
        league_id: leagueId,
        movie_id: '00000000-0000-0000-0000-000000000099',
      })
      assertEquals(result.error, 'Movie not found in this league draft')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully creates counterpick', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-success'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status
      await serviceClient.from('leagues').update({ status: 'counterpicking' }).eq('id', leagueId)

      // Get user 1's team (their picks can be counterpicked by user 2)
      const { data: userData } = await client.auth.getUser()
      const { data: participant } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team = participant?.teams as unknown as { id: string }

      // Get user 1's draft pick (opponent movie for user 2)
      const { data: opponentPicks } = await serviceClient
        .from('draft_picks')
        .select('movie_id, movies(id, title)')
        .eq('league_id', leagueId)
        .eq('team_id', team?.id)
        .limit(1)

      if (opponentPicks && opponentPicks.length > 0) {
        // User 2 counterpicks user 1's movie (user 2 picks first in reverse order)
        const { data, error } = await secondClient.functions.invoke('make-counterpick', {
          body: {
            league_id: leagueId,
            movie_id: opponentPicks[0].movie_id,
          },
        })

        assertEquals(error, null)
        assertExists(data.counterpick)
        assertExists(data.movie)
        assertExists(data.target_team)
        assertEquals(data.counterpick.league_id, leagueId)
        assertEquals(data.counterpick.movie_id, opponentPicks[0].movie_id)
        assertEquals(data.counterpick.target_team_id, team?.id)
        assertEquals(data.counterpick.phase, 'draft')
        assertEquals(data.counterpick.pick_order, 1)
      }
    })

    await t.step('updates draft_pick.counterpicked_by_team_id', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-update'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status
      await serviceClient.from('leagues').update({ status: 'counterpicking' }).eq('id', leagueId)

      // Get user 1's team
      const { data: userData } = await client.auth.getUser()
      const { data: participant } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team1 = participant?.teams as unknown as { id: string }

      // Get user 2's team
      const { data: secondUserData } = await secondClient.auth.getUser()
      const { data: participant2 } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team2 = participant2?.teams as unknown as { id: string }

      // Get user 1's draft pick
      const { data: opponentPicks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1?.id)
        .limit(1)

      if (opponentPicks && opponentPicks.length > 0) {
        // User 2 counterpicks
        await secondClient.functions.invoke('make-counterpick', {
          body: {
            league_id: leagueId,
            movie_id: opponentPicks[0].movie_id,
          },
        })

        // Verify draft_pick was updated
        const { data: updatedPick } = await serviceClient
          .from('draft_picks')
          .select('counterpicked_by_team_id')
          .eq('id', opponentPicks[0].id)
          .single()

        assertEquals(updatedPick?.counterpicked_by_team_id, team2?.id)
      }
    })

    await t.step('returns 400 when movie already counterpicked', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-duplicate'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status with multiple slots
      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking', draft_counterpick_slots: 3 })
        .eq('id', leagueId)

      // Get user 1's team
      const { data: userData } = await client.auth.getUser()
      const { data: participant } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team1 = participant?.teams as unknown as { id: string }

      // Get user 1's draft picks
      const { data: opponentPicks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1?.id)

      if (opponentPicks && opponentPicks.length >= 1) {
        // User 2 counterpicks first movie (their turn first in reverse order)
        await secondClient.functions.invoke('make-counterpick', {
          body: {
            league_id: leagueId,
            movie_id: opponentPicks[0].movie_id,
          },
        })

        // User 1 tries to counterpick the same movie (their turn second)
        const result = await invokeFunction(client, 'make-counterpick', {
          league_id: leagueId,
          movie_id: opponentPicks[0].movie_id,
        })
        assertEquals(result.error, 'This movie has already been counterpicked')
      }
    })

    await t.step('transitions league to active when round completes', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('counterpick-complete'))
      const serviceClient = getServiceClient()

      // Put league in counterpicking status with 1 slot per player
      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking', draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get user 1's team
      const { data: userData } = await client.auth.getUser()
      const { data: participant } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team1 = participant?.teams as unknown as { id: string }

      // Get user 2's team
      const { data: secondUserData } = await secondClient.auth.getUser()
      const { data: participant2 } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team2 = participant2?.teams as unknown as { id: string }

      // Get draft picks from both teams
      const { data: team1Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1?.id)
        .limit(1)

      const { data: team2Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team2?.id)
        .limit(1)

      if (team1Picks?.length && team2Picks?.length) {
        // User 2 makes first counterpick (reverse order - they drafted second)
        const result1 = await secondClient.functions.invoke('make-counterpick', {
          body: {
            league_id: leagueId,
            movie_id: team1Picks[0].movie_id,
          },
        })

        assertEquals(result1.error, null)
        assertEquals(result1.data.round_complete, false)

        // User 1 makes second counterpick
        const result2 = await client.functions.invoke('make-counterpick', {
          body: {
            league_id: leagueId,
            movie_id: team2Picks[0].movie_id,
          },
        })

        assertEquals(result2.error, null)
        assertEquals(result2.data.round_complete, true)

        // Verify league status changed to active
        const { data: league } = await serviceClient
          .from('leagues')
          .select('status')
          .eq('id', leagueId)
          .single()

        assertEquals(league?.status, 'active')
      }
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
