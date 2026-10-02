/**
 * Unit tests for a movie's fantasy points within one season.
 *
 * Pure -- no database. The cases mirror supabase/tests/league_scoring_rule.sql,
 * which checks the SQL league_fantasy_points() this helper has to agree with.
 */

import { assertEquals } from '@std/assert'
import { leagueFantasyPoints } from './fantasy-points.ts'

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
