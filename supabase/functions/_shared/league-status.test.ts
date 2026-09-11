/**
 * Unit tests for the completed-season write guard.
 *
 * Pure -- no database. What matters here is that exactly one status freezes a
 * league and that the refusal is a 400 carrying the one canonical message, so
 * the fourteen write functions that call this cannot drift apart.
 */

import { assertEquals } from '@std/assert'
import { assertLeagueWritable, SEASON_FINISHED_MESSAGE } from './league-status.ts'

/** Every status a league can hold that is not the frozen one. */
const WRITABLE_STATUSES = ['setup', 'drafting', 'active']

Deno.test('assertLeagueWritable allows every non-completed status', () => {
  for (const status of WRITABLE_STATUSES) {
    assertEquals(assertLeagueWritable({ status }).ok, true, `${status} should be writable`)
  }
})

Deno.test('assertLeagueWritable refuses a completed league with a 400', async () => {
  const result = assertLeagueWritable({ status: 'completed' })

  assertEquals(result.ok, false)
  if (result.ok) throw new Error('unreachable')

  assertEquals(result.response.status, 400)
  const body = await result.response.json()
  assertEquals(body.error, SEASON_FINISHED_MESSAGE)
})

Deno.test('assertLeagueWritable says "season", never "league"', () => {
  // The season is what ended; the league (the series) continues into the next
  // one. Copy that says otherwise reads like the league was deleted.
  assertEquals(SEASON_FINISHED_MESSAGE.toLowerCase().includes('season'), true)
  assertEquals(SEASON_FINISHED_MESSAGE.toLowerCase().includes('league'), false)
})

Deno.test('assertLeagueWritable treats a null status as writable', () => {
  // leagues.status is nullable in the schema (it defaults to 'setup'). A NULL
  // there is not a finished season, and must not be mistaken for one.
  assertEquals(assertLeagueWritable({ status: null }).ok, true)
})

Deno.test('assertLeagueWritable treats a missing league as writable', () => {
  // Callers that reach the league through an optional read or a nullable embed
  // pass whatever they got. Nothing there is a finished season, and each of
  // them has its own answer for a league it could not read.
  assertEquals(assertLeagueWritable(null).ok, true)
  assertEquals(assertLeagueWritable(undefined).ok, true)
})
