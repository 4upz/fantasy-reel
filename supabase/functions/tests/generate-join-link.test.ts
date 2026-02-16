/**
 * Integration tests for generate-join-link Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'generate-join-link',
  // Supabase client starts internal intervals for auth refresh that we don't control
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // Create a league for testing (owner is the authenticated user)
  let testLeagueId: string

  await t.step('setup: create test league', async () => {
    const leagueName = uniqueName('join-link-test')
    const { data, error } = await client.functions.invoke('create-league', {
      body: { name: leagueName },
    })
    assertEquals(error, null)
    assertExists(data.league)
    testLeagueId = data.league.id
    factory.trackLeague(testLeagueId)
  })

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'generate-join-link', { league_id: testLeagueId })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 when league_id is missing', async () => {
    const result = await invokeFunction(client, 'generate-join-link', {})
    assertEquals(result.error, 'league_id is required')
  })

  await t.step('returns 400 when league_id is invalid UUID', async () => {
    const result = await invokeFunction(client, 'generate-join-link', { league_id: 'not-a-uuid' })
    assertEquals(result.error, 'Invalid league_id')
  })

  await t.step('returns 404 for non-existent league', async () => {
    const result = await invokeFunction(client, 'generate-join-link', {
      league_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    })
    assertEquals(result.error, 'League not found')
  })

  // ============================================================================
  // Authorization Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    // Use a different user who is NOT the league owner
    const result = await invokeFunction(secondClient, 'generate-join-link', {
      league_id: testLeagueId,
    })
    assertEquals(result.error, 'Only the league owner can generate join links')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when league is not in setup status', async () => {
    // Create a league and start its draft to change status
    const leagueName = uniqueName('join-link-drafted')
    const { data: createData } = await client.functions.invoke('create-league', {
      body: { name: leagueName },
    })
    factory.trackLeague(createData.league.id)

    // Add second participant so we can start draft
    await factory.addSecondParticipant(createData.league.id)

    // Start the draft to change status from 'setup' to 'drafting'
    await client.functions.invoke('start-draft', {
      body: { league_id: createData.league.id },
    })

    const result = await invokeFunction(client, 'generate-join-link', {
      league_id: createData.league.id,
    })
    assertEquals(result.error, 'Cannot generate join link after draft has started')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('successfully generates join link', async () => {
    const { data, error } = await client.functions.invoke('generate-join-link', {
      body: { league_id: testLeagueId },
    })

    assertEquals(error, null)
    assertExists(data.join_code)
    assertExists(data.join_token)
    assertExists(data.join_url)
    assertEquals(data.league_id, testLeagueId)

    // Verify join_code format (6 chars, uppercase alphanumeric excluding ambiguous)
    assertEquals(data.join_code.length, 6)
    assertEquals(/^[A-HJ-KM-NP-Z2-9]{6}$/.test(data.join_code), true)

    // Verify join_url contains the code
    assertEquals(data.join_url.includes(data.join_code), true)
  })

  await t.step('regenerating replaces existing code', async () => {
    // First generation
    const { data: data1, error: error1 } = await client.functions.invoke('generate-join-link', {
      body: { league_id: testLeagueId },
    })
    assertEquals(error1, null)
    assertExists(data1.join_code)
    assertExists(data1.join_token)

    // Second generation should produce different values
    const { data: data2, error: error2 } = await client.functions.invoke('generate-join-link', {
      body: { league_id: testLeagueId },
    })
    assertEquals(error2, null)
    assertExists(data2.join_code)
    assertExists(data2.join_token)

    // Codes should be different (statistically almost certain)
    // Note: There's a tiny chance they could be the same, but with 30^6 possibilities it's negligible
    assertEquals(data1.join_code !== data2.join_code || data1.join_token !== data2.join_token, true)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
