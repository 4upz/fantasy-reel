/**
 * Unit tests for a movie's fantasy points within one season.
 *
 * Pure -- no database. The cases mirror supabase/tests/league_scoring_rule.sql,
 * which checks the SQL league_fantasy_points() this helper has to agree with.
 */

import { assertEquals } from '@std/assert'
import { fantasyPointsForTomatometer, leagueFantasyPoints } from './fantasy-points.ts'

Deno.test('leagueFantasyPoints - double points add the points above 90', () => {
  assertEquals(leagueFantasyPoints(35, 95, true), 40)
  assertEquals(leagueFantasyPoints(40, 100, true), 50)
})

Deno.test('leagueFantasyPoints - the default rule leaves points alone', () => {
  assertEquals(leagueFantasyPoints(35, 95, false), 35)
})

Deno.test('leagueFantasyPoints - double points only apply above 90', () => {
  assertEquals(leagueFantasyPoints(30, 90, true), 30)
  assertEquals(leagueFantasyPoints(-12.5, 45, true), -12.5)
})

Deno.test('leagueFantasyPoints - points without a Tomatometer get no bonus', () => {
  assertEquals(leagueFantasyPoints(35, null, true), 35)
})

Deno.test('fantasyPointsForTomatometer - follows the CLAUDE.md curve examples', () => {
  assertEquals(fantasyPointsForTomatometer(96), 36)
  assertEquals(fantasyPointsForTomatometer(96, true), 42)
  assertEquals(fantasyPointsForTomatometer(84), 24)
  assertEquals(fantasyPointsForTomatometer(60), 0)
  assertEquals(fantasyPointsForTomatometer(35), -16.25)
})

Deno.test('fantasyPointsForTomatometer - each tier joins the next without a jump', () => {
  assertEquals(fantasyPointsForTomatometer(50), -10)
  assertEquals(fantasyPointsForTomatometer(40), -15)
  assertEquals(fantasyPointsForTomatometer(30), -17.5)
  assertEquals(fantasyPointsForTomatometer(20), -18.75)
  assertEquals(fantasyPointsForTomatometer(10), -19.37) // Math.round half-up, as on the frontend
  assertEquals(fantasyPointsForTomatometer(0), -19.69)
})
