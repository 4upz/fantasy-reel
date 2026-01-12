/**
 * Integration tests for start-draft Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName } from './_setup.ts'

Deno.test('start-draft', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('start-draft', {
      body: { league_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const { data } = await client.functions.invoke('start-draft', {
      body: {},
    })
    assertEquals(data?.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid UUID format', async () => {
    const { data } = await client.functions.invoke('start-draft', {
      body: { league_id: 'not-a-valid-uuid' },
    })
    assertEquals(data?.error, 'Valid league_id is required')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const { data } = await client.functions.invoke('start-draft', {
      body: { league_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('permission-test'))
    await factory.addSecondParticipant(leagueId)

    const { data } = await secondClient.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })
    assertEquals(data?.error, 'Only the league owner can start the draft')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when league has less than 2 participants', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('single-participant'))

    const { data } = await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })
    assertEquals(data?.error, 'Need at least 2 participants to start the draft')
  })

  await t.step('returns 400 when league is already in drafting status', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('already-drafting'))
    await factory.addSecondParticipant(leagueId)

    // Start draft first time
    await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })

    // Try to start draft again
    const { data } = await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })
    assertEquals(data?.error, "Cannot start draft: league is already in 'drafting' status")
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('returns 200 and updates status on success', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('start-success'))
    await factory.addSecondParticipant(leagueId)

    const { data, error } = await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.league)
    assertEquals(data.league.status, 'drafting')
    assertEquals(data.message, 'Draft started successfully')
    assertEquals(data.participant_count, 2)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
})
