/**
 * Integration tests for place-counterpick-bid slot accounting.
 *
 * A won counterpick bid consumes exactly ONE bidding counterpick slot, but it
 * leaves TWO rows behind: a `counterpicks` row (phase='bidding') and the
 * original `counterpick_bids` row flipped to status='won'. Both are written by
 * process-bids for the same win, so they must never be summed when counting
 * used slots.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestFactory,
  getServiceClient,
  uniqueName,
  invokeFunction,
} from './_setup.ts'

/**
 * Simulate a counterpick bid that has already been won and processed,
 * writing exactly the rows process-bids writes for a win.
 */
async function simulateWonCounterpickBid(
  serviceClient: SupabaseClient,
  leagueId: string,
  winnerTeamId: string,
  draftPick: { id: string; movie_id: string; team_id: string },
  pickOrder: number,
): Promise<void> {
  const { error: counterpickError } = await serviceClient.from('counterpicks').insert({
    league_id: leagueId,
    counterpicker_team_id: winnerTeamId,
    target_team_id: draftPick.team_id,
    movie_id: draftPick.movie_id,
    draft_pick_id: draftPick.id,
    pick_order: pickOrder,
    phase: 'bidding',
  })
  if (counterpickError) throw new Error(`Failed to seed counterpick: ${counterpickError.message}`)

  const { error: bidError } = await serviceClient.from('counterpick_bids').insert({
    league_id: leagueId,
    team_id: winnerTeamId,
    movie_id: draftPick.movie_id,
    target_team_id: draftPick.team_id,
    draft_pick_id: draftPick.id,
    amount: 1,
    status: 'won',
    processing_deadline: new Date().toISOString(),
  })
  if (bidError) throw new Error(`Failed to seed won bid: ${bidError.message}`)

  const { error: updateError } = await serviceClient
    .from('draft_picks')
    .update({ counterpicked_by_team_id: winnerTeamId })
    .eq('id', draftPick.id)
  if (updateError) throw new Error(`Failed to mark draft pick: ${updateError.message}`)
}

Deno.test({
  name: 'place-counterpick-bid: bidding counterpick slot accounting',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    const leagueId = await factory.createActiveLeague(uniqueName('CP Slot'), 2)

    await serviceClient
      .from('leagues')
      .update({ bidding_counterpick_slots: 2 })
      .eq('id', leagueId)

    const myTeam = await factory.getTeamForUser(leagueId, client)
    if (!myTeam) throw new Error('Team not found for first user')

    const opponentTeam = await factory.getTeamForUser(leagueId, secondClient)
    if (!opponentTeam) throw new Error('Team not found for second user')

    const { data: opponentPicks } = await serviceClient
      .from('draft_picks')
      .select('id, movie_id, team_id')
      .eq('league_id', leagueId)
      .eq('team_id', opponentTeam.teamId)
      .is('dropped_at', null)
      .order('pick_number', { ascending: true })

    if (!opponentPicks || opponentPicks.length < 2) {
      throw new Error('Expected opponent to hold at least 2 draft picks')
    }

    await t.step('a team with 1 of 2 slots used can still place a counterpick bid', async () => {
      await simulateWonCounterpickBid(
        serviceClient,
        leagueId,
        myTeam.teamId,
        opponentPicks[0],
        1,
      )

      const result = await invokeFunction(client, 'place-counterpick-bid', {
        league_id: leagueId,
        movie_id: opponentPicks[1].movie_id,
        amount: 5,
      })

      assertEquals(result.error, null)
    })

    await t.step('a team with all slots used is rejected', async () => {
      // The bid placed above has not been processed, so it does not consume a
      // slot yet. Seed a second processed win to fill the team's 2 slots.
      const { data: extraPicks } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id, team_id')
        .eq('league_id', leagueId)
        .eq('team_id', opponentTeam.teamId)
        .is('dropped_at', null)
        .is('counterpicked_by_team_id', null)
        .order('pick_number', { ascending: true })

      if (!extraPicks || extraPicks.length < 2) {
        throw new Error('Expected at least 2 un-counterpicked opponent picks')
      }

      await simulateWonCounterpickBid(
        serviceClient,
        leagueId,
        myTeam.teamId,
        extraPicks[0],
        2,
      )

      const result = await invokeFunction(client, 'place-counterpick-bid', {
        league_id: leagueId,
        movie_id: extraPicks[1].movie_id,
        amount: 5,
      })

      assertEquals(result.error, 'You have used all your bidding counterpick slots')
    })

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})

/**
 * Generate a tmdb_id well outside the real TMDb ID range, the shared
 * draft-movie pool (factory picks use a per-run 900m-940m range - see
 * createActiveLeague), and other test files' void ranges (e.g.
 * process-bids.test.ts uses 950_000_000+, place-bid.test.ts uses
 * 960_000_000+). Release-date tests need a movie nobody else touches so
 * they don't corrupt the shared pool.
 */
function uniqueVoidTestTmdbId(): number {
  return 970_000_000 + Math.floor(Math.random() * 1_000_000)
}

Deno.test({
  name: 'place-counterpick-bid: release-date validation and pickup-sourced targets',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    // ============================================================================
    // Release-Date Validation
    //
    // A movie whose release_date has already passed has a known outcome -
    // counterpick-bidding on it is a risk-free exploit. The bid must be
    // rejected before it is ever written.
    // ============================================================================

    await t.step('returns 400 when the targeted movie has already been released', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cpbid-released'), 2)
      await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

      const opponentTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!opponentTeam) throw new Error('Team not found for second user')

      // Dedicated movie row, not a shared pool fixture, so mutating its
      // release date can't break other tests.
      const tmdbId = uniqueVoidTestTmdbId()
      const draftPickId = await factory.createDraftPickForUser(leagueId, secondClient, {
        tmdb_id: tmdbId,
        title: `Released CP Bid Movie ${tmdbId}`,
        release_date: '2020-01-01',
      })
      const { data: draftPick } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('id', draftPickId)
        .single()
      if (!draftPick) throw new Error('Draft pick not found')

      const result = await invokeFunction(client, 'place-counterpick-bid', {
        league_id: leagueId,
        movie_id: draftPick.movie_id,
        amount: 5,
      })

      assertEquals(result.status, 400)
      assertEquals(result.error, 'Cannot counterpick this movie: Movie was released in a previous season')

      const { data: bids } = await serviceClient
        .from('counterpick_bids')
        .select('id')
        .eq('league_id', leagueId)
        .eq('movie_id', draftPick.movie_id)
      assertEquals(bids?.length ?? 0, 0)
    })

    // ============================================================================
    // Pickup-Sourced Targets
    //
    // A movie an opponent acquired via pickup (not draft) must be a valid
    // counterpick target: the bid should succeed and record pickup_id with
    // draft_pick_id left null.
    // ============================================================================

    await t.step('succeeds against an opponent movie acquired via pickup', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('cpbid-pickup'), 2)
      await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

      const myTeam = await factory.getTeamForUser(leagueId, client)
      const opponentTeam = await factory.getTeamForUser(leagueId, secondClient)
      if (!myTeam || !opponentTeam) throw new Error('Team not found')

      const tmdbId = uniqueVoidTestTmdbId()
      const pickupId = await factory.createPickupForUser(leagueId, secondClient, {
        tmdb_id: tmdbId,
        title: `Pickup CP Bid Movie ${tmdbId}`,
        release_date: '2099-01-01',
      })
      const { data: pickup } = await serviceClient
        .from('pickups')
        .select('movie_id')
        .eq('id', pickupId)
        .single()
      if (!pickup) throw new Error('Pickup not found')

      const result = await invokeFunction<{ bid: { id: string } }>(client, 'place-counterpick-bid', {
        league_id: leagueId,
        movie_id: pickup.movie_id,
        amount: 5,
      })

      assertEquals(result.error, null)
      const bidId = result.data?.bid.id
      if (!bidId) throw new Error('Expected a bid id in the response')

      const { data: bidRow } = await serviceClient
        .from('counterpick_bids')
        .select('pickup_id, draft_pick_id, team_id, target_team_id')
        .eq('id', bidId)
        .single()

      assertEquals(bidRow?.pickup_id, pickupId)
      assertEquals(bidRow?.draft_pick_id, null)
      assertEquals(bidRow?.team_id, myTeam.teamId)
      assertEquals(bidRow?.target_team_id, opponentTeam.teamId)
    })

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
