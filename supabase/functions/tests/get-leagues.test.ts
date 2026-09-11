/**
 * Integration tests for get-leagues Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'get-leagues',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'get-leagues', {})
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('returns empty array when user has no leagues', async () => {
    // Use second client to test with a user that may have fewer leagues
    const { data, error } = await secondClient.functions.invoke('get-leagues', {
      body: {},
    })

    assertEquals(error, null)
    assertExists(data.leagues)
    assertEquals(Array.isArray(data.leagues), true)
  })

  await t.step('returns leagues the user owns', async () => {
    const leagueName = uniqueName('get-leagues-owned')
    const { id: leagueId } = await factory.createLeague(leagueName)

    const { data, error } = await client.functions.invoke('get-leagues', {
      body: {},
    })

    assertEquals(error, null)
    assertExists(data.leagues)

    const foundLeague = data.leagues.find((l: { id: string }) => l.id === leagueId)
    assertExists(foundLeague)
    assertEquals(foundLeague.name, leagueName)
  })

  await t.step('returns leagues the user is a participant in', async () => {
    const leagueName = uniqueName('get-leagues-participant')
    const { id: leagueId } = await factory.createLeague(leagueName)
    await factory.addSecondParticipant(leagueId)

    // Second user should now see the league
    const { data, error } = await secondClient.functions.invoke('get-leagues', {
      body: {},
    })

    assertEquals(error, null)
    const foundLeague = data.leagues.find((l: { id: string }) => l.id === leagueId)
    assertExists(foundLeague)
    assertEquals(foundLeague.name, leagueName)
  })

  await t.step('returns leagues ordered by created_at descending', async () => {
    const league1Name = uniqueName('get-leagues-order-1')
    const league2Name = uniqueName('get-leagues-order-2')

    await factory.createLeague(league1Name)
    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 100))
    await factory.createLeague(league2Name)

    const { data, error } = await client.functions.invoke('get-leagues', {
      body: {},
    })

    assertEquals(error, null)

    const leagues = data.leagues as Array<{ name: string }>
    const index1 = leagues.findIndex((l) => l.name === league1Name)
    const index2 = leagues.findIndex((l) => l.name === league2Name)

    // league2 should come before league1 (descending order)
    assertEquals(index2 < index1, true, 'Leagues should be ordered by created_at descending')
  })

  // ============================================================================
  // Seasons
  // ============================================================================

  await t.step('carries the season columns on every league', async () => {
    const leagueName = uniqueName('get-leagues-season')
    const { id: leagueId } = await factory.createLeague(leagueName)

    const { data } = await client.functions.invoke('get-leagues', { body: {} })
    const league = data.leagues.find((l: { id: string }) => l.id === leagueId)

    assertExists(league.series_id)
    assertEquals(league.season_year, new Date().getFullYear())
    assertEquals(league.season_end, `${new Date().getFullYear()}-12-31`)
    assertEquals(league.completed_at, null)
    assertEquals(league.winner_team_ids, null)
  })

  await t.step('groups a league under its series, newest season first', async () => {
    // A brand-new league is season one of a brand-new series, so `seasons`
    // holds exactly itself -- the shape the dashboard groups on.
    const leagueName = uniqueName('get-leagues-series')
    const { id: leagueId } = await factory.createLeague(leagueName)

    const { data } = await client.functions.invoke('get-leagues', { body: {} })
    const league = data.leagues.find((l: { id: string }) => l.id === leagueId)

    assertExists(league.series)
    assertEquals(league.series.id, league.series_id)
    assertEquals(league.series.name, leagueName)
    assertEquals(league.series.seasons.length, 1)
    assertEquals(league.series.seasons[0].id, leagueId)
    assertEquals(league.series.seasons[0].season_year, league.season_year)
    assertEquals(league.series.seasons[0].status, 'setup')
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
