/**
 * Integration tests for the completed-season write guard.
 *
 * A finished season is immutable: its standings are final and its champions
 * recorded, so nothing that could move a roster or a score may happen
 * afterwards. `assertLeagueWritable` (_shared/league-status.ts) is the single
 * refusal, and these tests check it actually reached every write family --
 * one per family, since the helper itself is unit-tested.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import {
  createTestFactory,
  getServiceClient,
  uniqueName,
  invokeFunction,
} from './_setup.ts'
import { SEASON_FINISHED_MESSAGE } from '../_shared/league-status.ts'

/** Move a league to its finished state, as `complete_league` would. */
async function completeLeague(leagueId: string): Promise<void> {
  const { error } = await getServiceClient()
    .from('leagues')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', leagueId)
  if (error) throw new Error(`Failed to complete league: ${error.message}`)
}

/** One drafted holding, in the shape propose-trade takes. */
function tradeItem(pick: { id: string; movie_id: string }) {
  return { movie_id: pick.movie_id, source: 'draft_pick', source_id: pick.id }
}

/** A movie far enough out that only the season guard can refuse it. */
function upcomingMovie(tmdbId: number, title: string) {
  const nextYear = new Date().getFullYear() + 1
  return { tmdb_id: tmdbId, title, release_date: `${nextYear}-12-01` }
}

Deno.test({
  name: 'completed season refuses writes',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ========================================================================
    // Bids
    // ========================================================================

    await t.step('place-bid refuses a bid on a finished season', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('guard-bid'))
      await completeLeague(leagueId)

      const movie = upcomingMovie(603692, 'Guard Test Pickup')
      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: movie.tmdb_id,
        amount: 5,
        movie_data: movie,
      })

      assertEquals(result.error, SEASON_FINISHED_MESSAGE)
      assertEquals(result.status, 400)
    })

    await t.step('set-bid-priorities refuses a reorder on a finished season', async () => {
      // The guard has to answer before "you have no pending bids": the league
      // status is the reason, and it is the one the user can act on.
      const leagueId = await factory.createActiveLeague(uniqueName('guard-priorities'))
      await completeLeague(leagueId)

      const result = await invokeFunction(client, 'set-bid-priorities', {
        league_id: leagueId,
        bid_ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      })

      assertEquals(result.error, SEASON_FINISHED_MESSAGE)
      assertEquals(result.status, 400)
    })

    // ========================================================================
    // Counterpicks
    // ========================================================================

    await t.step('place-counterpick-bid refuses a bid on a finished season', async () => {
      // Target one of the opponent's drafted movies -- createActiveLeague has
      // already run a full draft, so there is no need to plant another pick.
      const leagueId = await factory.createActiveLeague(uniqueName('guard-cp-bid'))
      const opponentPicks = await factory.getDraftPicksForUser(leagueId, secondClient)
      await completeLeague(leagueId)

      const result = await invokeFunction(client, 'place-counterpick-bid', {
        league_id: leagueId,
        movie_id: opponentPicks[0].movie_id,
        amount: 5,
      })

      assertEquals(result.error, SEASON_FINISHED_MESSAGE)
      assertEquals(result.status, 400)
    })

    await t.step('set-counterpick-bid-priorities refuses a reorder on a finished season', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('guard-cp-priorities'))
      await completeLeague(leagueId)

      const result = await invokeFunction(client, 'set-counterpick-bid-priorities', {
        league_id: leagueId,
        bid_ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      })

      assertEquals(result.error, SEASON_FINISHED_MESSAGE)
      assertEquals(result.status, 400)
    })

    // ========================================================================
    // Drops
    // ========================================================================

    await t.step('drop-movie refuses a drop on a finished season', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('guard-drop'))
      const picks = await factory.getDraftPicksForUser(leagueId, client)
      await completeLeague(leagueId)

      const result = await invokeFunction(client, 'drop-movie', {
        draft_pick_id: picks[0].id,
      })

      assertEquals(result.error, SEASON_FINISHED_MESSAGE)
      assertEquals(result.status, 400)
    })

    // ========================================================================
    // Trades -- both shapes: a new proposal, and an action on a standing offer
    // ========================================================================

    await t.step('propose-trade and cancel-trade both refuse on a finished season', async () => {
      const leagueId = await factory.createTradingLeague(uniqueName('guard-trade'))
      const recipient = await factory.getTeamForUser(leagueId, secondClient)
      if (!recipient) throw new Error('Recipient team not found')

      const myPicks = await factory.getDraftPicksForUser(leagueId, client)

      // Proposed while the season is still running, so there is a standing
      // offer to act on once it ends.
      const proposal = await invokeFunction<{ trade_offer: { id: string } }>(
        client,
        'propose-trade',
        {
          league_id: leagueId,
          recipient_team_id: recipient.teamId,
          offered_items: { movies: [tradeItem(myPicks[0])], faab: 0 },
          requested_items: { movies: [], faab: 1 },
        },
      )
      assertEquals(proposal.error, null)
      const tradeOfferId = proposal.data!.trade_offer.id

      await completeLeague(leagueId)

      // A new proposal: refused by validateLeagueTradingEnabled, reached
      // through validateTradeProposal.
      const proposeAgain = await invokeFunction(client, 'propose-trade', {
        league_id: leagueId,
        recipient_team_id: recipient.teamId,
        offered_items: { movies: [tradeItem(myPicks[1])], faab: 0 },
        requested_items: { movies: [], faab: 1 },
      })
      assertEquals(proposeAgain.error, SEASON_FINISHED_MESSAGE)
      assertEquals(proposeAgain.status, 400)

      // An action on the standing offer: refused by getTradeOffer, which is
      // where respond / counter / cancel / extend all read the league.
      const cancel = await invokeFunction(client, 'cancel-trade', {
        trade_offer_id: tradeOfferId,
      })
      assertEquals(cancel.error, SEASON_FINISHED_MESSAGE)
      assertEquals(cancel.status, 400)
    })

    // ========================================================================
    // Joining
    // ========================================================================

    await t.step('join-league refuses a finished season', async () => {
      // Ahead of the invite-only and "draft has started" answers: a stale link
      // to a season that ended should say so, not describe last year's draft.
      const { id: leagueId } = await factory.createLeague(uniqueName('guard-join'))
      await completeLeague(leagueId)

      const result = await invokeFunction(secondClient, 'join-league', {
        league_id: leagueId,
      })

      assertEquals(result.error, SEASON_FINISHED_MESSAGE)
      assertEquals(result.status, 400)
    })

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
