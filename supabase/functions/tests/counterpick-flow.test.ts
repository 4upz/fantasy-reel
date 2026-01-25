/**
 * Integration tests for the complete counterpick flow
 *
 * Tests the full lifecycle:
 * 1. Draft completion (drafting status)
 * 2. Counterpick round start (drafting -> counterpicking)
 * 3. Counterpick turns (reverse draft order)
 * 4. Round completion (counterpicking -> active)
 * 5. Counterpick scoring (optional)
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestFactory,
  getServiceClient,
  uniqueName,
  invokeFunction,
  TestDataFactory,
} from './_setup.ts'

/**
 * Type for start-counterpick-round response
 */
interface StartCounterpickRoundResponse {
  league: { status: string }
  message: string
  first_pick: {
    round: number
    pick_number: number
    team_id: string
    participant_id: string
    user_id: string
    counterpicks_remaining: number
  } | null
}

/**
 * Type for make-counterpick response
 */
interface MakeCounterpickResponse {
  counterpick: {
    id: string
    league_id: string
    movie_id: string
    target_team_id: string
    pick_order: number
    phase: string
  }
  movie: { id: string; title: string }
  target_team: { id: string; name: string }
  round_complete: boolean
}

/**
 * Helper to create a league with completed draft picks but still in 'drafting' status.
 * This is needed for counterpick testing because counterpicks happen after the draft
 * is complete but before the league transitions to 'active'.
 */
async function createLeagueWithDraftPicks(
  factory: TestDataFactory,
  client: SupabaseClient,
  secondClient: SupabaseClient,
  serviceClient: SupabaseClient,
  name: string,
  draftSlotsPerPlayer = 3
): Promise<string> {
  // Create league and add participants
  const { id: leagueId } = await factory.createLeague(name)
  await factory.addSecondParticipant(leagueId)

  // Configure draft slots
  await serviceClient
    .from('leagues')
    .update({ draft_slots: draftSlotsPerPlayer })
    .eq('id', leagueId)

  // Start the draft
  const startResult = await invokeFunction(client, 'start-draft', { league_id: leagueId })
  if (startResult.error) throw new Error(`Failed to start draft: ${startResult.error}`)

  // Get clients in draft order
  const clients = [client, secondClient]
  const numParticipants = 2
  const totalPicks = draftSlotsPerPlayer * numParticipants
  let tmdbIdCounter = 300001 + Math.floor(Math.random() * 100000) // Random offset to avoid conflicts
  const currentYear = new Date().getFullYear()

  // Make all draft picks (snake draft)
  for (let pickNum = 1; pickNum <= totalPicks; pickNum++) {
    const round = Math.ceil(pickNum / numParticipants)
    const positionInRound = (pickNum - 1) % numParticipants

    // Snake draft: odd rounds go forward (0,1), even rounds go backward (1,0)
    let clientIndex: number
    if (round % 2 === 1) {
      clientIndex = positionInRound
    } else {
      clientIndex = numParticipants - 1 - positionInRound
    }

    const currentClient = clients[clientIndex]

    const movieData = {
      title: `Counterpick Test Movie ${tmdbIdCounter}`,
      overview: 'Test movie for counterpick flow',
      poster_url: '/test-poster.jpg',
      release_date: `${currentYear}-12-15`,
      vote_average: 7.5,
      popularity: 100,
      genre_ids: [28, 12],
    }

    const result = await invokeFunction(currentClient, 'draft-pick', {
      league_id: leagueId,
      tmdb_id: tmdbIdCounter,
      movie_data: movieData,
    })

    if (result.error) {
      throw new Error(`Failed to make draft pick ${pickNum}: ${result.error}`)
    }

    tmdbIdCounter++
  }

  // The draft-pick function auto-transitions to 'active' when draft completes.
  // For counterpick testing, we need to reset the status to 'drafting' to simulate
  // a completed draft that's ready for the counterpick round.
  await serviceClient
    .from('leagues')
    .update({ status: 'drafting' })
    .eq('id', leagueId)

  return leagueId
}

Deno.test({
  name: 'counterpick-flow',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    // ============================================================================
    // Full Flow: Draft Complete -> Counterpick Round -> Active
    // ============================================================================

    await t.step('full flow: draft complete -> counterpick round -> active', async () => {
      // Create a league with completed draft picks (but still in 'drafting' status)
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-full-flow'), 3
      )

      // Configure counterpick slots
      await serviceClient
        .from('leagues')
        .update({ draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get team info for both users
      const { data: userData } = await client.auth.getUser()
      const { data: secondUserData } = await secondClient.auth.getUser()

      const { data: team1Data } = await serviceClient
        .from('league_participants')
        .select('id, draft_order, teams(id, name)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const { data: team2Data } = await serviceClient
        .from('league_participants')
        .select('id, draft_order, teams(id, name)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team1 = team1Data?.teams as unknown as { id: string; name: string }
      const team2 = team2Data?.teams as unknown as { id: string; name: string }

      // Verify we have teams
      assertExists(team1)
      assertExists(team2)

      // Get draft picks from each team
      const { data: team1Picks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1.id)
        .limit(1)

      const { data: team2Picks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team2.id)
        .limit(1)

      assertExists(team1Picks)
      assertExists(team2Picks)
      assertEquals(team1Picks.length > 0, true, 'Team 1 should have draft picks')
      assertEquals(team2Picks.length > 0, true, 'Team 2 should have draft picks')

      // Step 1: Owner starts the counterpick round
      const startResult = await invokeFunction<StartCounterpickRoundResponse>(
        client, 'start-counterpick-round', { league_id: leagueId }
      )

      assertEquals(startResult.error, null, `Start counterpick should not fail: ${startResult.error}`)
      assertExists(startResult.data)
      assertEquals(startResult.data.league.status, 'counterpicking')
      assertExists(startResult.data.first_pick)

      // Step 2: Verify which team goes first (reverse draft order)
      const firstPickTeamId = startResult.data.first_pick!.team_id

      // Determine which client should make the first counterpick
      const firstPickerClient = firstPickTeamId === team2.id ? secondClient : client
      const secondPickerClient = firstPickTeamId === team2.id ? client : secondClient
      const firstPickerTarget = firstPickTeamId === team2.id ? team1Picks : team2Picks
      const secondPickerTarget = firstPickTeamId === team2.id ? team2Picks : team1Picks

      // Step 3: First player (by reverse draft order) makes counterpick
      const cp1Result = await firstPickerClient.functions.invoke('make-counterpick', {
        body: {
          league_id: leagueId,
          movie_id: firstPickerTarget[0].movie_id,
        },
      })

      assertEquals(cp1Result.error, null)
      assertExists(cp1Result.data.counterpick)
      assertEquals(cp1Result.data.counterpick.pick_order, 1)
      assertEquals(cp1Result.data.round_complete, false)

      // Step 4: Second player makes counterpick
      const cp2Result = await secondPickerClient.functions.invoke('make-counterpick', {
        body: {
          league_id: leagueId,
          movie_id: secondPickerTarget[0].movie_id,
        },
      })

      assertEquals(cp2Result.error, null)
      assertExists(cp2Result.data.counterpick)
      assertEquals(cp2Result.data.counterpick.pick_order, 2)
      assertEquals(cp2Result.data.round_complete, true)

      // Step 5: Verify league is now active
      const { data: finalLeague } = await serviceClient
        .from('leagues')
        .select('status')
        .eq('id', leagueId)
        .single()

      assertEquals(finalLeague?.status, 'active')

      // Step 6: Verify counterpicks are recorded correctly
      const { data: counterpicks } = await serviceClient
        .from('counterpicks')
        .select('*')
        .eq('league_id', leagueId)
        .order('pick_order', { ascending: true })

      assertEquals(counterpicks?.length, 2)
      assertEquals(counterpicks?.[0].phase, 'draft')
      assertEquals(counterpicks?.[1].phase, 'draft')
    })

    // ============================================================================
    // Turn Order Validation: Reverse Draft Order
    // ============================================================================

    await t.step('turn order: last drafter picks first in counterpick round', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-turn-order'), 2
      )

      await serviceClient
        .from('leagues')
        .update({ draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get participants with draft orders
      const { data: participants } = await serviceClient
        .from('league_participants')
        .select('id, user_id, draft_order, teams(id)')
        .eq('league_id', leagueId)
        .eq('status', 'active')
        .order('draft_order', { ascending: true })

      assertExists(participants)
      assertEquals(participants.length, 2)

      // In a 2-player league: draft_order 1 picks first in draft, draft_order 2 picks last
      // In counterpick round: draft_order 2 should pick first (reverse order)
      const lastDrafter = participants.find(p => p.draft_order === 2)
      assertExists(lastDrafter)

      // Start counterpick round
      const startResult = await invokeFunction<StartCounterpickRoundResponse>(
        client, 'start-counterpick-round', { league_id: leagueId }
      )

      assertEquals(startResult.error, null, `Start counterpick should not fail: ${startResult.error}`)
      assertExists(startResult.data?.first_pick)

      // Verify the last drafter (draft_order=2) picks first in counterpicking
      assertEquals(startResult.data!.first_pick!.team_id, (lastDrafter.teams as unknown as { id: string }).id)
    })

    await t.step('get_next_counterpick_turn returns correct team', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-rpc'), 2
      )

      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking', draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Call RPC function
      const { data: turnInfo, error } = await serviceClient.rpc('get_next_counterpick_turn', {
        p_league_id: leagueId,
      })

      assertEquals(error, null)
      assertExists(turnInfo)
      assertEquals(turnInfo.length, 1)

      const turn = turnInfo[0]
      assertExists(turn.team_id)
      assertExists(turn.participant_id)
      assertExists(turn.user_id)
      assertEquals(turn.round, 1)
      assertEquals(turn.pick_number, 1)
      assertEquals(turn.counterpicks_remaining, 1)
    })

    // ============================================================================
    // Counterpick Options: Only Opponent Movies
    // ============================================================================

    await t.step('get_counterpick_options returns only opponent movies', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-options'), 2
      )

      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking', draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get team 1's ID
      const { data: userData } = await client.auth.getUser()
      const { data: participant } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team1 = participant?.teams as unknown as { id: string }
      assertExists(team1)

      // Call RPC to get counterpick options for team 1
      const { data: options, error } = await serviceClient.rpc('get_counterpick_options', {
        p_league_id: leagueId,
        p_team_id: team1.id,
      })

      assertEquals(error, null)
      assertExists(options)
      assertEquals(options.length > 0, true, 'Should have counterpick options')

      // All options should NOT be team 1's movies
      for (const option of options) {
        assertEquals(
          option.owner_team_id !== team1.id,
          true,
          'Should not return own movies as counterpick options'
        )
      }
    })

    // ============================================================================
    // Multi-Round Counterpicking (2 slots per player)
    // ============================================================================

    await t.step('multi-round counterpicking with 2 slots', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-multi-round'), 3 // 3 picks each so we have enough for 2 counterpicks
      )

      // Configure 2 counterpick slots per player
      await serviceClient
        .from('leagues')
        .update({ draft_counterpick_slots: 2 })
        .eq('id', leagueId)

      // Get team info for both users
      const { data: userData } = await client.auth.getUser()
      const { data: secondUserData } = await secondClient.auth.getUser()

      const { data: team1Data } = await serviceClient
        .from('league_participants')
        .select('id, draft_order, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const { data: team2Data } = await serviceClient
        .from('league_participants')
        .select('id, draft_order, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team1 = team1Data?.teams as unknown as { id: string }
      const team2 = team2Data?.teams as unknown as { id: string }

      // Get multiple draft picks from each team
      const { data: team1Picks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1.id)
        .limit(2)

      const { data: team2Picks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team2.id)
        .limit(2)

      assertExists(team1Picks)
      assertExists(team2Picks)
      assertEquals(team1Picks.length >= 2, true, 'Team 1 should have at least 2 draft picks')
      assertEquals(team2Picks.length >= 2, true, 'Team 2 should have at least 2 draft picks')

      // Start counterpick round
      const startResult = await invokeFunction<StartCounterpickRoundResponse>(
        client, 'start-counterpick-round', { league_id: leagueId }
      )

      assertEquals(startResult.error, null, `Start counterpick should not fail: ${startResult.error}`)
      assertExists(startResult.data)
      const firstPickTeamId = startResult.data.first_pick!.team_id

      // Determine picker order
      const isSecondUserFirst = firstPickTeamId === team2.id
      const firstPicker = isSecondUserFirst ? secondClient : client
      const secondPicker = isSecondUserFirst ? client : secondClient
      const firstTargets = isSecondUserFirst ? team1Picks : team2Picks
      const secondTargets = isSecondUserFirst ? team2Picks : team1Picks

      // Round 1: Both players make their first counterpick
      // Pick 1: First player (reverse order)
      const cp1 = await firstPicker.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: firstTargets[0].movie_id },
      })
      assertEquals(cp1.error, null)
      assertEquals(cp1.data.round_complete, false)

      // Pick 2: Second player
      const cp2 = await secondPicker.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: secondTargets[0].movie_id },
      })
      assertEquals(cp2.error, null)
      assertEquals(cp2.data.round_complete, false)

      // Round 2: Snake back - second player picks first this time
      // Pick 3: Second player (snake reversal)
      const cp3 = await secondPicker.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: secondTargets[1].movie_id },
      })
      assertEquals(cp3.error, null)
      assertEquals(cp3.data.round_complete, false)

      // Pick 4: First player (completes the round)
      const cp4 = await firstPicker.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: firstTargets[1].movie_id },
      })
      assertEquals(cp4.error, null)
      assertEquals(cp4.data.round_complete, true)

      // Verify all 4 counterpicks were recorded
      const { data: counterpicks } = await serviceClient
        .from('counterpicks')
        .select('pick_order, phase')
        .eq('league_id', leagueId)
        .order('pick_order', { ascending: true })

      assertEquals(counterpicks?.length, 4)
      assertEquals(counterpicks?.every(cp => cp.phase === 'draft'), true)

      // Verify league is active
      const { data: league } = await serviceClient
        .from('leagues')
        .select('status')
        .eq('id', leagueId)
        .single()

      assertEquals(league?.status, 'active')
    })

    // ============================================================================
    // Counterpick Scoring: Inverted Fantasy Points
    // ============================================================================

    await t.step('counterpick scoring: points are inverted from movie score', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-scoring'), 2
      )

      await serviceClient
        .from('leagues')
        .update({ draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get team info
      const { data: userData } = await client.auth.getUser()
      const { data: team1Data } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team1 = team1Data?.teams as unknown as { id: string }

      // Get a movie from team 1 to use for scoring test
      const { data: team1Picks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id, movies(id)')
        .eq('league_id', leagueId)
        .eq('team_id', team1.id)
        .limit(1)

      assertExists(team1Picks)
      assertEquals(team1Picks.length > 0, true, 'Team 1 should have draft picks')
      const movieId = team1Picks[0].movie_id

      // Start counterpick round
      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking' })
        .eq('id', leagueId)

      // User 2 counterpicks user 1's movie
      await secondClient.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: movieId },
      })

      // Complete the round by having user 1 counterpick (need another movie)
      const { data: team2Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .neq('team_id', team1.id)
        .limit(1)

      if (team2Picks?.length) {
        await client.functions.invoke('make-counterpick', {
          body: { league_id: leagueId, movie_id: team2Picks[0].movie_id },
        })
      }

      // Set fantasy_points on the counterpicked movie
      const testPoints = 15.50
      await serviceClient
        .from('movies')
        .update({ fantasy_points: testPoints })
        .eq('id', movieId)

      // The trigger should update counterpick.fantasy_points to the inverted value
      const { data: counterpick } = await serviceClient
        .from('counterpicks')
        .select('fantasy_points')
        .eq('movie_id', movieId)
        .single()

      assertExists(counterpick)
      // Inverted: if movie scores +15.50, counterpicker gets -15.50
      assertEquals(Number(counterpick.fantasy_points), -testPoints)
    })

    await t.step('team_scores includes counterpick_points', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-team-scores'), 2
      )

      await serviceClient
        .from('leagues')
        .update({ draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get team info
      const { data: secondUserData } = await secondClient.auth.getUser()
      const { data: team2Data } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team2 = team2Data?.teams as unknown as { id: string }

      // Get team 1's movie for counterpicking
      const { data: userData } = await client.auth.getUser()
      const { data: team1Data } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const team1 = team1Data?.teams as unknown as { id: string }

      const { data: team1Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1.id)
        .limit(1)

      assertExists(team1Picks)
      assertEquals(team1Picks.length > 0, true, 'Team 1 should have draft picks')
      const movieId = team1Picks[0].movie_id

      // Put league in counterpicking and make a counterpick
      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking' })
        .eq('id', leagueId)

      await secondClient.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: movieId },
      })

      // Complete the round
      const { data: team2Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team2.id)
        .limit(1)

      if (team2Picks?.length) {
        await client.functions.invoke('make-counterpick', {
          body: { league_id: leagueId, movie_id: team2Picks[0].movie_id },
        })
      }

      // Score the counterpicked movie (negative score = positive for counterpicker)
      const testPoints = -10.00 // Bad movie
      await serviceClient
        .from('movies')
        .update({ fantasy_points: testPoints })
        .eq('id', movieId)

      // Recalculate team 2's score
      await serviceClient.rpc('recalculate_team_score_with_counterpicks', {
        p_team_id: team2.id,
      })

      // Verify team_scores includes counterpick points
      const { data: teamScore } = await serviceClient
        .from('team_scores')
        .select('total_points, draft_points, counterpick_points, counterpicks_made')
        .eq('team_id', team2.id)
        .single()

      assertExists(teamScore)
      assertEquals(teamScore.counterpicks_made, 1)
      // Inverted: movie scored -10, so counterpicker gets +10
      assertEquals(Number(teamScore.counterpick_points), 10.00)
    })

    // ============================================================================
    // Edge Cases
    // ============================================================================

    await t.step('returns empty when all counterpicks complete', async () => {
      const leagueId = await createLeagueWithDraftPicks(
        factory, client, secondClient, serviceClient,
        uniqueName('cp-complete'), 2
      )

      await serviceClient
        .from('leagues')
        .update({ status: 'counterpicking', draft_counterpick_slots: 1 })
        .eq('id', leagueId)

      // Get team info and movies
      const { data: userData } = await client.auth.getUser()
      const { data: secondUserData } = await secondClient.auth.getUser()

      const { data: team1Data } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', userData?.user?.id)
        .single()

      const { data: team2Data } = await serviceClient
        .from('league_participants')
        .select('id, teams(id)')
        .eq('league_id', leagueId)
        .eq('user_id', secondUserData?.user?.id)
        .single()

      const team1 = team1Data?.teams as unknown as { id: string }
      const team2 = team2Data?.teams as unknown as { id: string }

      const { data: team1Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team1.id)
        .limit(1)

      const { data: team2Picks } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('league_id', leagueId)
        .eq('team_id', team2.id)
        .limit(1)

      assertExists(team1Picks)
      assertExists(team2Picks)
      assertEquals(team1Picks.length > 0, true)
      assertEquals(team2Picks.length > 0, true)

      // Complete all counterpicks
      await secondClient.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: team1Picks[0].movie_id },
      })

      await client.functions.invoke('make-counterpick', {
        body: { league_id: leagueId, movie_id: team2Picks[0].movie_id },
      })

      // Now get_next_counterpick_turn should return empty
      const { data: turnInfo, error } = await serviceClient.rpc('get_next_counterpick_turn', {
        p_league_id: leagueId,
      })

      assertEquals(error, null)
      assertEquals(turnInfo?.length ?? 0, 0)
    })

    // Note: "cannot counterpick already counterpicked movie" is already tested
    // in make-counterpick.test.ts with proper turn order handling

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
