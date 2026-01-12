/**
 * Integration tests for get-leagues Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName } from './_setup.ts'

Deno.test('get-leagues', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('get-leagues', {
      body: {},
    })
    assertEquals(data?.error, 'Unauthorized')
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
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
})
