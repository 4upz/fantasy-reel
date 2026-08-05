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
