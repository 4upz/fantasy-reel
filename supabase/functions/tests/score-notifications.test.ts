/**
 * Integration tests for score notification snapshots.
 *
 * These run the real PostgREST queries against a local Supabase instance.
 * That matters: the unit-test mock passes `select`/`eq`/`is` through as
 * no-ops, so it cannot catch a wrong table, column, filter, or FK constraint
 * name. Everything schema-facing is verified here instead.
 *
 * Requires local Supabase running with seed data.
 */

import { assertEquals, assertExists } from '@std/assert'
import { getServiceClient } from './_setup.ts'
import {
  captureScoreContext,
  snapshotStandings,
} from '../_shared/score-notifications.ts'

// Seeded fixtures (supabase/seed.sql)
const OSCAR_LEAGUE = '22222222-bbbb-bbbb-bbbb-222222222222'
const DRAFTED_MOVIE = 'f0000016-0000-0000-0000-000000000016' // Oppenheimer, drafted
const PICKUP_MOVIE = 'f0000015-0000-0000-0000-000000000015' // Fast X Part 2, won at auction by Bob's team

Deno.test('score-notifications snapshots', async (t) => {
  const supabase = getServiceClient()

  await t.step('captureScoreContext resolves a drafted movie to its league and owner', async () => {
    const context = await captureScoreContext(supabase, [DRAFTED_MOVIE])

    const placement = context.placements.find((p) => p.leagueId === OSCAR_LEAGUE)
    assertExists(placement, 'drafted movie should produce a placement')
    assertEquals(placement.movieId, DRAFTED_MOVIE)
    assertEquals(placement.ownerTeamName, 'Award Hunters')
  })

  await t.step('captureScoreContext resolves a movie won at auction', async () => {
    // Regression guard: pickups are a separate table from draft_picks, and
    // omitting them silently suppressed notifications for auction-won movies.
    const context = await captureScoreContext(supabase, [PICKUP_MOVIE])

    const placement = context.placements.find((p) => p.leagueId === OSCAR_LEAGUE)
    assertExists(placement, 'pickup movie should produce a placement')
    assertEquals(placement.ownerTeamName, 'Golden Globe Gang')
  })

  await t.step('captureScoreContext reports the leagues holding a movie', async () => {
    const context = await captureScoreContext(supabase, [PICKUP_MOVIE])
    assertEquals(context.leagueIds.includes(OSCAR_LEAGUE), true)
  })

  await t.step('captureScoreContext snapshots prior scores as numbers', async () => {
    const context = await captureScoreContext(supabase, [DRAFTED_MOVIE])

    const scores = context.previousMovieScores.get(DRAFTED_MOVIE)
    assertExists(scores, 'a held movie should be snapshotted')
    // PostgREST encodes numeric as a JSON number; a string here would break
    // the > / !== comparisons used to decide direction and change detection.
    assertEquals(scores.points === null || typeof scores.points === 'number', true)
    // combined_score is the Tomatometer, now the headline in every embed
    assertEquals(scores.rtScore === null || typeof scores.rtScore === 'number', true)
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
    const standings = await snapshotStandings(supabase, [OSCAR_LEAGUE])
    const league = standings.get(OSCAR_LEAGUE)

    assertExists(league)
    assertEquals(league.length >= 3, true)

    // Ranks must be dense from 1 and ordered by descending points
    assertEquals(league[0].rank, 1)
    for (let i = 1; i < league.length; i++) {
      assertEquals(league[i].points <= league[i - 1].points, true)
      assertEquals(league[i].rank >= league[i - 1].rank, true)
    }
  })

  await t.step('snapshotStandings returns points as numbers', async () => {
    const standings = await snapshotStandings(supabase, [OSCAR_LEAGUE])

    for (const team of standings.get(OSCAR_LEAGUE) ?? []) {
      assertEquals(typeof team.points, 'number')
      assertEquals(Number.isNaN(team.points), false)
    }
  })

  await t.step('snapshotStandings defaults a team with no score row to zero', async () => {
    // Every league team must appear, including ones that never scored --
    // otherwise ranks shift and produce bogus movement messages.
    const { data: teams } = await supabase
      .from('league_participants')
      .select('id')
      .eq('league_id', OSCAR_LEAGUE)
      .eq('status', 'active')

    const standings = await snapshotStandings(supabase, [OSCAR_LEAGUE])
    assertEquals(standings.get(OSCAR_LEAGUE)?.length, teams?.length)
  })

  await t.step('snapshotStandings returns nothing for no leagues', async () => {
    const standings = await snapshotStandings(supabase, [])
    assertEquals(standings.size, 0)
  })
})
