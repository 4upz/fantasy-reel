/**
 * Integration tests for score notification snapshots.
 *
 * These run the real PostgREST queries against a local Supabase instance.
 * That matters: the unit-test mock passes `select`/`eq`/`is` through as
 * no-ops, so it cannot catch a wrong table, column, filter, or FK constraint
 * name. Everything schema-facing is verified here instead.
 *
 * Requires local Supabase running; fixtures are created and cleaned up by this suite.
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, uniqueName } from './_setup.ts'
import {
  captureScoreContext,
  snapshotStandings,
} from '../_shared/score-notifications.ts'

Deno.test({
  name: 'score-notifications snapshots',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const supabase = getServiceClient()
    const movieIds = [crypto.randomUUID(), crypto.randomUUID()]
    const [draftedMovieId, pickupMovieId] = movieIds

    try {
      const { id: leagueId } = await factory.createLeague(uniqueName('score-notifications'))
      await factory.addSecondParticipant(leagueId)
      const thirdClient = await factory.createThirdClient()
      await factory.addParticipantToLeague(leagueId, thirdClient)

      const draftTeam = await factory.getTeamForUser(leagueId, client)
      const pickupTeam = await factory.getTeamForUser(leagueId, secondClient)
      const unscoredTeam = await factory.getTeamForUser(leagueId, thirdClient)
      assertExists(draftTeam)
      assertExists(pickupTeam)
      assertExists(unscoredTeam)

      const { error: leagueError } = await supabase
        .from('leagues').update({ status: 'active' }).eq('id', leagueId)
      assertEquals(leagueError, null)
      for (const [teamId, name] of [
        [draftTeam.teamId, 'Draft Owners'],
        [pickupTeam.teamId, 'Pickup Owners'],
        [unscoredTeam.teamId, 'Unscored Team'],
      ]) {
        const { error } = await supabase.from('teams').update({ name }).eq('id', teamId)
        assertEquals(error, null)
      }

      // Keep these movies outside the shared draft pool and other suites' ranges.
      const tmdbBase = 1_900_000_000 + Math.floor(Math.random() * 1_000_000) * 2
      const draftMovie = {
        id: draftedMovieId,
        tmdb_id: tmdbBase,
        title: 'Score Snapshot Draft Movie',
        release_date: '2099-06-01',
        status: 'upcoming',
        fantasy_points: 42.5,
        combined_score: 85,
      }
      const pickupMovie = {
        id: pickupMovieId,
        tmdb_id: tmdbBase + 1,
        title: 'Score Snapshot Pickup Movie',
        release_date: '2099-06-01',
        status: 'upcoming',
        fantasy_points: 12.25,
        combined_score: 70,
      }
      const { error: movieError } = await supabase.from('movies').insert([draftMovie, pickupMovie])
      assertEquals(movieError, null)
      await factory.createDraftPickForUser(leagueId, client, draftMovie)
      await factory.createPickupForUser(leagueId, secondClient, pickupMovie)

      const { error: teamScoreError } = await supabase.from('team_scores').upsert([
        { team_id: draftTeam.teamId, total_points: 42.5 },
        { team_id: pickupTeam.teamId, total_points: 12.25 },
      ], { onConflict: 'team_id' })
      assertEquals(teamScoreError, null)
      const { error: missingScoreError } = await supabase.from('team_scores')
        .delete().eq('team_id', unscoredTeam.teamId)
      assertEquals(missingScoreError, null)

      await t.step('captureScoreContext resolves a drafted movie to its league and owner', async () => {
        const context = await captureScoreContext(supabase, [draftedMovieId])

        const placement = context.placements.find((p) => p.leagueId === leagueId)
        assertExists(placement, 'drafted movie should produce a placement')
        assertEquals(placement.movieId, draftedMovieId)
        assertEquals(placement.ownerTeamName, 'Draft Owners')
      })

      await t.step('captureScoreContext resolves a movie won at auction', async () => {
        // Regression guard: pickups are a separate table from draft_picks, and
        // omitting them silently suppressed notifications for auction-won movies.
        const context = await captureScoreContext(supabase, [pickupMovieId])

        const placement = context.placements.find((p) => p.leagueId === leagueId)
        assertExists(placement, 'pickup movie should produce a placement')
        assertEquals(placement.ownerTeamName, 'Pickup Owners')
      })

      await t.step('captureScoreContext reports the leagues holding a movie', async () => {
        const context = await captureScoreContext(supabase, [pickupMovieId])
        assertEquals(context.leagueIds.includes(leagueId), true)
      })

      await t.step('captureScoreContext snapshots prior scores as numbers', async () => {
        const context = await captureScoreContext(supabase, [draftedMovieId])

        const scores = context.previousMovieScores.get(draftedMovieId)
        assertExists(scores, 'a held movie should be snapshotted')
        // PostgREST encodes numeric as a JSON number; a string here would break
        // the > / !== comparisons used to decide direction and change detection.
        assertEquals(scores.points === null || typeof scores.points === 'number', true)
        // combined_score is the Tomatometer, now the headline in every embed
        assertEquals(scores.rtScore === null || typeof scores.rtScore === 'number', true)
        assertEquals(scores, { points: 42.5, rtScore: 85 })
      })

      await t.step('captureScoreContext returns empty for an unheld movie', async () => {
        const context = await captureScoreContext(
          supabase,
          ['00000000-0000-0000-0000-000000000000']
        )

        assertEquals(context.leagueIds.length, 0)
        assertEquals(context.placements.length, 0)
      })

      await t.step('captureScoreContext no-ops on an empty movie list', async () => {
        const context = await captureScoreContext(supabase, [])
        assertEquals(context.leagueIds.length, 0)
        assertEquals(context.placements.length, 0)
      })

      await t.step('snapshotStandings ranks every team in the league', async () => {
        const standings = await snapshotStandings(supabase, [leagueId])
        const league = standings.get(leagueId)

        assertExists(league)
        assertEquals(league.length, 3)

        // Ranks start at 1 and follow descending points.
        assertEquals(league[0].rank, 1)
        for (let i = 1; i < league.length; i++) {
          assertEquals(league[i].points <= league[i - 1].points, true)
          assertEquals(league[i].rank >= league[i - 1].rank, true)
        }
      })

      await t.step('snapshotStandings returns points as numbers', async () => {
        const standings = await snapshotStandings(supabase, [leagueId])

        const teams = standings.get(leagueId)
        assertExists(teams)
        assertEquals(teams.length, 3)
        for (const team of teams) {
          assertEquals(typeof team.points, 'number')
          assertEquals(Number.isNaN(team.points), false)
        }
      })

      await t.step('snapshotStandings defaults a team with no score row to zero', async () => {
        // Every league team must appear, including ones that never scored --
        // otherwise ranks shift and produce bogus movement messages.
        const { data: teams, error } = await supabase
          .from('league_participants')
          .select('id')
          .eq('league_id', leagueId)
          .eq('status', 'active')

        assertEquals(error, null)
        assertExists(teams)
        assertEquals(teams.length, 3)

        const standings = await snapshotStandings(supabase, [leagueId])
        const league = standings.get(leagueId)
        assertExists(league)
        assertEquals(league.length, teams.length)
        const unscored = league.find((team) => team.teamId === unscoredTeam.teamId)
        assertExists(unscored)
        assertEquals(unscored.points, 0)
      })

      await t.step('snapshotStandings returns nothing for no leagues', async () => {
        const standings = await snapshotStandings(supabase, [])
        assertEquals(standings.size, 0)
      })
    } finally {
      try {
        await factory.cleanup()
      } finally {
        // Movie deletion requires service-role access; the factory uses the owner client.
        const { error } = await supabase.from('movies').delete().in('id', movieIds)
        assertEquals(error, null)
      }
    }
  },
})
