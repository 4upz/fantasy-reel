/**
 * Regression tests for team score recalculation (GitHub issue #17)
 *
 * `recalculate_team_score_with_counterpicks` used to read only `draft_picks`,
 * with no `dropped_at` filter. That meant auction pickups were worth zero and
 * dropped movies scored forever. `recalculate_teams_for_movie` had a matching
 * gap: it located affected teams via draft picks and counterpicks only, so a
 * movie held solely via pickup never triggered a recalculation for its owner.
 *
 * Requires: npx supabase start
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, uniqueName } from './_setup.ts'

const currentYear = new Date().getFullYear()
const testMovieData = {
  overview: 'A test movie for score recalculation',
  poster_url: '/test-poster.jpg',
  release_date: `${currentYear}-12-15`,
  vote_average: 0,
  popularity: 100,
}

Deno.test({
  name: 'team score recalculation (issue #17)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    /** Set a movie's fantasy points directly, bypassing the scoring pipeline. */
    async function setFantasyPoints(movieId: string, points: number): Promise<void> {
      const { error } = await serviceClient
        .from('movies')
        .update({ fantasy_points: points })
        .eq('id', movieId)
      if (error) throw new Error(`Failed to set fantasy_points: ${error.message}`)
    }

    async function recalculate(teamId: string): Promise<void> {
      const { error } = await serviceClient.rpc('recalculate_team_score_with_counterpicks', {
        p_team_id: teamId,
      })
      if (error) throw new Error(`Recalculation failed: ${error.message}`)
    }

    async function getScore(teamId: string) {
      const { data } = await serviceClient
        .from('team_scores')
        .select('total_points, draft_points, pickup_points, movies_scored, movies_pending')
        .eq('team_id', teamId)
        .single()
      return data
    }

    async function getMovieIdForPickup(pickupId: string): Promise<string> {
      const { data } = await serviceClient
        .from('pickups')
        .select('movie_id')
        .eq('id', pickupId)
        .single()
      if (!data) throw new Error('Pickup not found')
      return data.movie_id
    }

    // ========================================================================
    // Defect 1: pickups contribute zero points
    // ========================================================================

    await t.step('pickup points count toward total_points', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-pickup'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 600001,
        ...testMovieData,
        title: 'Scored Pickup Movie',
      })
      await setFantasyPoints(await getMovieIdForPickup(pickupId), 12.5)
      await recalculate(team.teamId)

      const score = await getScore(team.teamId)
      assertExists(score)
      assertEquals(Number(score.pickup_points), 12.5)
      assertEquals(Number(score.total_points), 12.5)
      assertEquals(score.movies_scored, 1)
    })

    await t.step('total_points sums draft picks and pickups together', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-combined'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 600002,
        ...testMovieData,
        title: 'Combined Draft Movie',
      })
      const { data: pick } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('id', draftPickId)
        .single()
      assertExists(pick)
      await setFantasyPoints(pick.movie_id, 10)

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 600003,
        ...testMovieData,
        title: 'Combined Pickup Movie',
      })
      await setFantasyPoints(await getMovieIdForPickup(pickupId), -4)

      await recalculate(team.teamId)

      const score = await getScore(team.teamId)
      assertExists(score)
      assertEquals(Number(score.draft_points), 10)
      assertEquals(Number(score.pickup_points), -4)
      assertEquals(Number(score.total_points), 6)
      // Both roster sources count toward the scored tally
      assertEquals(score.movies_scored, 2)
    })

    // ========================================================================
    // Defect 2: dropped movies keep scoring
    // ========================================================================

    await t.step('dropped pickup stops contributing points', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-drop-pickup'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 600004,
        ...testMovieData,
        title: 'Dropped Pickup Movie',
      })
      await setFantasyPoints(await getMovieIdForPickup(pickupId), 20)
      await recalculate(team.teamId)
      assertEquals(Number((await getScore(team.teamId))?.total_points), 20)

      await serviceClient
        .from('pickups')
        .update({ dropped_at: new Date().toISOString() })
        .eq('id', pickupId)
      await recalculate(team.teamId)

      const score = await getScore(team.teamId)
      assertExists(score)
      assertEquals(Number(score.total_points), 0)
      assertEquals(Number(score.pickup_points), 0)
      assertEquals(score.movies_scored, 0)
    })

    await t.step('dropped draft pick stops contributing points', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-drop-draft'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      const draftPickId = await factory.createDraftPickForUser(leagueId, client, {
        tmdb_id: 600005,
        ...testMovieData,
        title: 'Dropped Draft Movie',
      })
      const { data: pick } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('id', draftPickId)
        .single()
      assertExists(pick)
      await setFantasyPoints(pick.movie_id, 15)
      await recalculate(team.teamId)
      assertEquals(Number((await getScore(team.teamId))?.total_points), 15)

      await serviceClient
        .from('draft_picks')
        .update({ dropped_at: new Date().toISOString() })
        .eq('id', draftPickId)
      await recalculate(team.teamId)

      const score = await getScore(team.teamId)
      assertExists(score)
      assertEquals(Number(score.total_points), 0)
      assertEquals(Number(score.draft_points), 0)
      assertEquals(score.movies_scored, 0)
    })

    // ========================================================================
    // Double-count guard: a dropped draft pick can be re-acquired at auction
    // ========================================================================

    await t.step('re-acquiring a dropped movie via pickup counts it once', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-reacquire'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      const movie = { tmdb_id: 600006, ...testMovieData, title: 'Re-acquired Movie' }
      const draftPickId = await factory.createDraftPickForUser(leagueId, client, movie)
      const { data: pick } = await serviceClient
        .from('draft_picks')
        .select('movie_id')
        .eq('id', draftPickId)
        .single()
      assertExists(pick)
      await setFantasyPoints(pick.movie_id, 8)

      // Drop it, then win the same movie back at auction
      await serviceClient
        .from('draft_picks')
        .update({ dropped_at: new Date().toISOString() })
        .eq('id', draftPickId)
      await factory.createPickupForUser(leagueId, client, movie)

      await recalculate(team.teamId)

      const score = await getScore(team.teamId)
      assertExists(score)
      // Counted once, via the active pickup only
      assertEquals(Number(score.total_points), 8)
      assertEquals(Number(score.draft_points), 0)
      assertEquals(Number(score.pickup_points), 8)
      assertEquals(score.movies_scored, 1)
    })

    // ========================================================================
    // Defect 3: a pickup-only movie never triggers recalculation
    // ========================================================================

    await t.step('recalculate_teams_for_movie reaches an owner holding only a pickup', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-cascade'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      const pickupId = await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 600007,
        ...testMovieData,
        title: 'Cascade Pickup Movie',
      })
      const movieId = await getMovieIdForPickup(pickupId)
      await setFantasyPoints(movieId, 5)
      await recalculate(team.teamId)
      assertEquals(Number((await getScore(team.teamId))?.total_points), 5)

      // Rescore the movie and cascade — the team is reachable only via `pickups`
      await setFantasyPoints(movieId, 25)
      const { error } = await serviceClient.rpc('recalculate_teams_for_movie', {
        p_movie_id: movieId,
      })
      assertEquals(error, null)

      const score = await getScore(team.teamId)
      assertExists(score)
      assertEquals(Number(score.total_points), 25)
    })

    // ========================================================================
    // Pending movies
    // ========================================================================

    await t.step('unscored pickups count as pending, not scored', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('score-pending'))
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      // The league's draft already left this team holding unscored picks, so
      // compare against that baseline rather than an absolute count.
      await recalculate(team.teamId)
      const before = await getScore(team.teamId)
      assertExists(before)

      await factory.createPickupForUser(leagueId, client, {
        tmdb_id: 600008,
        ...testMovieData,
        title: 'Pending Pickup Movie',
      })
      await recalculate(team.teamId)

      const score = await getScore(team.teamId)
      assertExists(score)
      assertEquals(score.movies_pending, before.movies_pending + 1)
      assertEquals(score.movies_scored, before.movies_scored)
      assertEquals(Number(score.total_points), Number(before.total_points))
    })

    await factory.cleanup()
  },
})
