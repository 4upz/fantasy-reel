/**
 * Integration tests for drop-movie Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestFactory,
  getAnonClient,
  getServiceClient,
  uniqueName,
  invokeFunction,
} from './_setup.ts'
import { seedCounterpickBid as seedCounterpickBidRow } from './_counterpick_helpers.ts'

// Test movie data for pickups
const currentYear = new Date().getFullYear()
const testMovieData = {
  title: 'Test Drop Movie',
  overview: 'A test movie for drop testing',
  poster_url: '/test-poster.jpg',
  release_date: `${currentYear}-12-15`,
  vote_average: 0,
  popularity: 100,
  genre_ids: [28, 12],
}

/**
 * Load a draft pick's movie_id/team_id, needed to seed a counterpick_bids row
 * (which requires draft_pick_id, movie_id, and the target team_id).
 */
async function getDraftPickRow(
  serviceClient: SupabaseClient,
  draftPickId: string
): Promise<{ id: string; movie_id: string; team_id: string }> {
  const { data, error } = await serviceClient
    .from('draft_picks')
    .select('id, movie_id, team_id')
    .eq('id', draftPickId)
    .single()
  if (error || !data) throw new Error(`Failed to load draft pick: ${error?.message}`)
  return data
}

/**
 * Seed a counterpick_bids row targeting a draft pick, simulating a bid placed
 * during the budget auction phase without going through place-counterpick-bid.
 */
function seedCounterpickBid(
  serviceClient: SupabaseClient,
  leagueId: string,
  bidderTeamId: string,
  draftPick: { id: string; movie_id: string; team_id: string },
  status: 'active' | 'outbid' | 'cancelled',
  amount = 5
): Promise<string> {
  return seedCounterpickBidRow(serviceClient, {
    leagueId,
    teamId: bidderTeamId,
    movieId: draftPick.movie_id,
    targetTeamId: draftPick.team_id,
    draftPickId: draftPick.id,
    amount,
    status,
  })
}

/** Directly flip a league's status (bypassing the normal phase-transition flow). */
async function setLeagueStatus(
  serviceClient: SupabaseClient,
  leagueId: string,
  status: string
): Promise<void> {
  const { error } = await serviceClient.from('leagues').update({ status }).eq('id', leagueId)
  if (error) throw new Error(`Failed to update league status: ${error.message}`)
}

/** Mark a pickup as awarded to a counterpicker, mirroring what process-bids does for draft picks. */
async function setPickupCounterpicked(
  serviceClient: SupabaseClient,
  pickupId: string,
  counterpickerTeamId: string
): Promise<void> {
  const { error } = await serviceClient
    .from('pickups')
    .update({ counterpicked_by_team_id: counterpickerTeamId })
    .eq('id', pickupId)
  if (error) throw new Error(`Failed to update pickup counterpick: ${error.message}`)
}

Deno.test({
  name: 'drop-movie',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'drop-movie', {
        pickup_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing both pickup_id and draft_pick_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {})
      assertEquals(result.error, 'Valid pickup_id or draft_pick_id is required')
    })

    await t.step('returns 400 for invalid pickup_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid pickup_id or draft_pick_id is required')
    })

    await t.step('returns 400 for invalid draft_pick_id', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid pickup_id or draft_pick_id is required')
    })

    await t.step('returns 400 when both pickup_id and draft_pick_id provided', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: '00000000-0000-0000-0000-000000000000',
        draft_pick_id: '00000000-0000-0000-0000-000000000001',
      })
      assertEquals(result.error, 'Provide only one of pickup_id or draft_pick_id')
    })

    // ============================================================================
    // Not Found Tests
    // ============================================================================

    await t.step('returns 404 when pickup does not exist', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Pickup not found')
    })

    await t.step('returns 404 when draft pick does not exist', async () => {
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Draft pick not found')
    })

    // ============================================================================
    // Authorization Tests (Pickups)
    // ============================================================================

    await t.step('returns 403 when trying to drop another team pickup', async () => {
      // Create active league and simulate a pickup for user1
      const leagueId = await factory.createActiveLeague(uniqueName('drop-not-owner'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500001,
        ...testMovieData,
        title: 'Not Owner Drop Movie',
      })

      // Second user tries to drop first user's pickup
      const result = await invokeFunction(secondClient, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'You can only drop your own movies')
    })

    // ============================================================================
    // Authorization Tests (Draft Picks)
    // ============================================================================

    await t.step('returns 403 when trying to drop another team draft pick', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-not-owner'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500101,
        ...testMovieData,
        title: 'Not Owner Draft Pick',
      })

      // Second user tries to drop first user's draft pick
      const result = await invokeFunction(secondClient, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'You can only drop your own movies')
    })

    // ============================================================================
    // Status Tests (Pickups)
    // ============================================================================

    await t.step('returns 400 when pickup has already been dropped', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-already'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500002,
        ...testMovieData,
        title: 'Already Dropped Movie',
      })

      // Drop the movie first time
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      // Try to drop again
      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'Movie has already been dropped')
    })

    await t.step('drops a pickup whose movie has already been released', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-released'))

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500003,
        ...testMovieData,
        title: 'Released Movie',
        release_date: '2024-01-01',
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
      // Nobody can bid a released movie back, so it is not offered around.
      assertEquals(data.available_for_pickup, false)
    })

    await t.step('does not announce a released drop as available for pickup', async () => {
      // createActiveLeague seeds a second participant, so there is somebody who
      // would have been notified.
      const leagueId = await factory.createActiveLeague(uniqueName('drop-released-quiet'))
      const serviceClient = getServiceClient()

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500013,
        ...testMovieData,
        title: 'Quietly Released Movie',
        release_date: '2024-01-01',
      })

      const { error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })
      assertEquals(error, null)

      const { data: notifications } = await serviceClient
        .from('notifications')
        .select('id')
        .eq('league_id', leagueId)
        .eq('type', 'pickup_available')

      assertEquals(notifications?.length ?? 0, 0)
    })

    // ============================================================================
    // Status Tests (Draft Picks)
    // ============================================================================

    await t.step('returns 400 when draft pick has already been dropped', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-already'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500102,
        ...testMovieData,
        title: 'Already Dropped Draft Pick',
      })

      // Drop the draft pick first time
      await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      // Try to drop again
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'Movie has already been dropped')
    })

    await t.step('drops a draft pick whose movie has already been released', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-released'))

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500103,
        ...testMovieData,
        title: 'Released Draft Pick',
        release_date: '2024-01-01',
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
      assertEquals(data.available_for_pickup, false)
    })

    /**
     * The reason a team spends a drop on a movie that is already out: the
     * points go with it. Guards the rescore trigger added in
     * 20260825120000_rescore_team_on_drop.sql -- without it team_scores would
     * keep paying out a movie the team no longer holds.
     */
    await t.step('removes a released movie\'s points from the team score', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-released-score'))
      const serviceClient = getServiceClient()

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500110,
        ...testMovieData,
        title: 'Scored Flop',
        release_date: '2024-01-01',
      })
      const draftPick = await getDraftPickRow(serviceClient, draftPickId)

      // Score the movie the way update-scores would, then bring the stored team
      // total in line with it.
      await serviceClient
        .from('movies')
        .update({ combined_score: 20, fantasy_points: -17.5, status: 'released' })
        .eq('id', draftPick.movie_id)
      await serviceClient.rpc('recalculate_team_score_with_counterpicks', {
        p_team_id: draftPick.team_id,
      })

      const { data: before } = await serviceClient
        .from('team_scores')
        .select('total_points')
        .eq('team_id', draftPick.team_id)
        .single()
      assertEquals(Number(before?.total_points), -17.5)

      const { error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })
      assertEquals(error, null)

      const { data: after } = await serviceClient
        .from('team_scores')
        .select('total_points')
        .eq('team_id', draftPick.team_id)
        .single()
      assertEquals(Number(after?.total_points), 0)
    })

    // ============================================================================
    // Drop Limit Tests
    // ============================================================================

    await t.step('returns 400 when drop limit is reached (pickups)', async () => {
      // Create active league with default drop_limit of 2
      const leagueId = await factory.createActiveLeague(uniqueName('drop-limit'))

      // Create and drop 2 movies (reaching the limit)
      const pickup1 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500004,
        ...testMovieData,
        title: 'Drop Limit Movie 1',
      })
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup1 },
      })

      const pickup2 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500005,
        ...testMovieData,
        title: 'Drop Limit Movie 2',
      })
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup2 },
      })

      // Try to drop a third movie
      const pickup3 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500006,
        ...testMovieData,
        title: 'Drop Limit Movie 3',
      })

      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickup3,
      })
      assertEquals(result.error, 'You have reached the drop limit of 2')
    })

    await t.step('shared drop limit across pickups and draft picks', async () => {
      // Create active league with default drop_limit of 2
      const leagueId = await factory.createActiveLeague(uniqueName('shared-limit'))

      // Drop 1 pickup
      const pickup1 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500201,
        ...testMovieData,
        title: 'Shared Limit Pickup',
      })
      await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup1 },
      })

      // Drop 1 draft pick (should work - still under limit)
      const draftPick1 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500202,
        ...testMovieData,
        title: 'Shared Limit Draft Pick 1',
      })
      const { data: drop2 } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPick1 },
      })
      assertEquals(drop2.drops_used, 2)
      assertEquals(drop2.drops_remaining, 0)

      // Try to drop another draft pick (should fail - limit reached)
      const draftPick2 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500203,
        ...testMovieData,
        title: 'Shared Limit Draft Pick 2',
      })
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPick2,
      })
      assertEquals(result.error, 'You have reached the drop limit of 2')
    })

    // ============================================================================
    // Success Tests (Pickups)
    // ============================================================================

    await t.step('successfully drops a pickup', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-success'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500007,
        ...testMovieData,
        title: 'Drop Success Movie',
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
      assertExists(data.movie)
      assertEquals(data.movie.title, 'Drop Success Movie')
      assertEquals(data.movie.tmdb_id, 500007)
      assertEquals(data.drops_used, 1)
      assertEquals(data.drops_remaining, 1) // Default limit is 2, used 1
    })

    await t.step('tracks pickup drop count correctly', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-count'))

      // First drop
      const pickup1 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500008,
        ...testMovieData,
        title: 'Count Movie 1',
      })
      const { data: drop1 } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup1 },
      })

      assertEquals(drop1.drops_used, 1)
      assertEquals(drop1.drops_remaining, 1)

      // Second drop
      const pickup2 = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500009,
        ...testMovieData,
        title: 'Count Movie 2',
      })
      const { data: drop2 } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickup2 },
      })

      assertEquals(drop2.drops_used, 2)
      assertEquals(drop2.drops_remaining, 0)
    })

    await t.step('allows dropping pickup with null release date', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-null-date'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500010,
        ...testMovieData,
        title: 'Null Date Movie',
        release_date: null,
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    // ============================================================================
    // Success Tests (Draft Picks)
    // ============================================================================

    await t.step('successfully drops a draft pick', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-success'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500104,
        ...testMovieData,
        title: 'Drop Draft Success',
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
      assertExists(data.movie)
      assertEquals(data.movie.title, 'Drop Draft Success')
      assertEquals(data.movie.tmdb_id, 500104)
      assertEquals(data.drops_used, 1)
      assertEquals(data.drops_remaining, 1)
    })

    await t.step('tracks draft pick drop count correctly', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-count'))

      // First drop (draft pick)
      const draftPick1 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500105,
        ...testMovieData,
        title: 'Draft Count 1',
      })
      const { data: drop1 } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPick1 },
      })

      assertEquals(drop1.drops_used, 1)
      assertEquals(drop1.drops_remaining, 1)

      // Second drop (draft pick)
      const draftPick2 = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500106,
        ...testMovieData,
        title: 'Draft Count 2',
      })
      const { data: drop2 } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPick2 },
      })

      assertEquals(drop2.drops_used, 2)
      assertEquals(drop2.drops_remaining, 0)
    })

    await t.step('allows dropping draft pick with null release date', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('draft-null-date'))
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500107,
        ...testMovieData,
        title: 'Null Date Draft Pick',
        release_date: null,
      })

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    // ============================================================================
    // League Status Tests
    // ============================================================================

    await t.step('returns 400 when league is not active (e.g. counterpicking phase)', async () => {
      const serviceClient = getServiceClient()
      const leagueId = await factory.createActiveLeague(uniqueName('drop-not-active'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 510001,
        ...testMovieData,
        title: 'Not Active Phase Movie',
      })

      // Simulate the league having moved back into (or still being in) the
      // counterpicking round, where drops should not be allowed.
      await setLeagueStatus(serviceClient, leagueId, 'counterpicking')

      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'Drops are only allowed while the league is active')
    })

    // ============================================================================
    // Counterpick Blocking Tests
    // ============================================================================

    await t.step('returns 400 when movie is counterpicked and blocking enabled', async () => {
      // Create active league (counterpicks_block_drops defaults to true)
      const leagueId = await factory.createActiveLeague(uniqueName('cp-block'))

      // Create a draft pick for user1
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500301,
        ...testMovieData,
        title: 'Counterpicked Movie',
      })

      // User2 counterpicks user1's movie
      await factory.addCounterpickToDraftPick(leagueId, draftPickId, secondClient)

      // User1 tries to drop the counterpicked movie - should fail
      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'Cannot drop a movie that has been counterpicked')
    })

    await t.step('allows drop when counterpick blocking is disabled', async () => {
      // Create active league
      const leagueId = await factory.createActiveLeague(uniqueName('cp-no-block'))

      // Disable counterpick blocking
      await factory.setCounterpickBlockDrops(leagueId, false)

      // Create a draft pick for user1
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500302,
        ...testMovieData,
        title: 'Counterpicked But Droppable',
      })

      // User2 counterpicks user1's movie
      await factory.addCounterpickToDraftPick(leagueId, draftPickId, secondClient)

      // User1 should still be able to drop (blocking disabled)
      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    await t.step('allows drop when movie is not counterpicked', async () => {
      // Create active league with blocking enabled
      const leagueId = await factory.createActiveLeague(uniqueName('cp-not-picked'))

      // Create a draft pick for user1 (not counterpicked)
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 500303,
        ...testMovieData,
        title: 'Non-Counterpicked Movie',
      })

      // User1 should be able to drop (no counterpick)
      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })

      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    await t.step('returns 400 dropping a draft pick with a pending (active) counterpick bid', async () => {
      const serviceClient = getServiceClient()
      const leagueId = await factory.createActiveLeague(uniqueName('cp-bid-active'))

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 510002,
        ...testMovieData,
        title: 'Pending Active Bid Movie',
      })
      const draftPick = await getDraftPickRow(serviceClient, draftPickId)

      const bidderTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!bidderTeam) throw new Error('Second user has no team in this league')
      await seedCounterpickBid(serviceClient, leagueId, bidderTeam.teamId, draftPick, 'active')

      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'Cannot drop this movie: another team has a pending counterpick bid on it')
    })

    await t.step('returns 400 dropping a draft pick with a pending (outbid) counterpick bid', async () => {
      const serviceClient = getServiceClient()
      const leagueId = await factory.createActiveLeague(uniqueName('cp-bid-outbid'))

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 510003,
        ...testMovieData,
        title: 'Pending Outbid Bid Movie',
      })
      const draftPick = await getDraftPickRow(serviceClient, draftPickId)

      const bidderTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!bidderTeam) throw new Error('Second user has no team in this league')
      await seedCounterpickBid(serviceClient, leagueId, bidderTeam.teamId, draftPick, 'outbid')

      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(result.error, 'Cannot drop this movie: another team has a pending counterpick bid on it')
    })

    await t.step('allows drop once the pending counterpick bid is cancelled', async () => {
      const serviceClient = getServiceClient()
      const leagueId = await factory.createActiveLeague(uniqueName('cp-bid-cancelled'))

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 510004,
        ...testMovieData,
        title: 'Cancelled Bid Movie',
      })
      const draftPick = await getDraftPickRow(serviceClient, draftPickId)

      const bidderTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!bidderTeam) throw new Error('Second user has no team in this league')
      const bidId = await seedCounterpickBid(serviceClient, leagueId, bidderTeam.teamId, draftPick, 'active')

      // Blocked while the bid is pending
      const blocked = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: draftPickId,
      })
      assertEquals(blocked.error, 'Cannot drop this movie: another team has a pending counterpick bid on it')

      // Cancel the bid, then the drop should succeed
      await serviceClient.from('counterpick_bids').update({ status: 'cancelled' }).eq('id', bidId)

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })
      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    await t.step('returns 400 dropping a pickup that has been counterpicked (H2 regression)', async () => {
      const serviceClient = getServiceClient()
      const leagueId = await factory.createActiveLeague(uniqueName('cp-block-pickup'))

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 510005,
        ...testMovieData,
        title: 'Counterpicked Pickup',
      })

      const counterpickerTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!counterpickerTeam) throw new Error('Second user has no team in this league')
      await setPickupCounterpicked(serviceClient, pickupId, counterpickerTeam.teamId)

      const result = await invokeFunction(client, 'drop-movie', {
        pickup_id: pickupId,
      })
      assertEquals(result.error, 'Cannot drop a movie that has been counterpicked')
    })

    await t.step('allows dropping a draft pick with a pending bid when blocking is disabled', async () => {
      const serviceClient = getServiceClient()
      const leagueId = await factory.createActiveLeague(uniqueName('cp-bid-no-block'))
      await factory.setCounterpickBlockDrops(leagueId, false)

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 510006,
        ...testMovieData,
        title: 'Pending Bid But Droppable',
      })
      const draftPick = await getDraftPickRow(serviceClient, draftPickId)

      const bidderTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!bidderTeam) throw new Error('Second user has no team in this league')
      await seedCounterpickBid(serviceClient, leagueId, bidderTeam.teamId, draftPick, 'active')

      const { data, error } = await client.functions.invoke('drop-movie', {
        body: { draft_pick_id: draftPickId },
      })
      assertEquals(error, null)
      assertEquals(data.message, 'Movie dropped successfully')
    })

    // ============================================================================
    // Notification Tests
    // ============================================================================

    await t.step('creates notifications for other league members when movie is dropped', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('drop-notify'))
      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 500011,
        ...testMovieData,
        title: 'Notify Drop Movie',
      })

      // Drop the movie
      const { error } = await client.functions.invoke('drop-movie', {
        body: { pickup_id: pickupId },
      })

      assertEquals(error, null)

      // Verify notification was created for second user
      // Note: This would require querying the notifications table directly
      // For now, we just verify the drop succeeded without error
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
