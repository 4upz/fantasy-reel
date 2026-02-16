/**
 * Integration tests for start-draft Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'start-draft',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'start-draft', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const result = await invokeFunction(client, 'start-draft', {})
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid UUID format', async () => {
    const result = await invokeFunction(client, 'start-draft', {
      league_id: 'not-a-valid-uuid',
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const result = await invokeFunction(client, 'start-draft', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('permission-test'))
    await factory.addSecondParticipant(leagueId)

    const result = await invokeFunction(secondClient, 'start-draft', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'Only the league owner can start the draft')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when league has less than 2 participants', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('single-participant'))

    const result = await invokeFunction(client, 'start-draft', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'Need at least 2 participants to start the draft')
  })

  await t.step('returns 400 when league is already in drafting status', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('already-drafting'))
    await factory.addSecondParticipant(leagueId)

    // Start draft first time
    await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })

    // Try to start draft again
    const result = await invokeFunction(client, 'start-draft', {
      league_id: leagueId,
    })
    assertEquals(result.error, "Cannot start draft: league is already in 'drafting' status")
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
  // Auto-Randomize Draft Order Tests
  // ============================================================================

  await t.step('auto-randomizes draft order when custom_draft_order is false', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('auto-randomize'))
    await factory.addSecondParticipant(leagueId)

    // Verify custom_draft_order is false before starting
    const { data: leagueBefore } = await client
      .from('leagues')
      .select('custom_draft_order')
      .eq('id', leagueId)
      .single()
    assertEquals(leagueBefore?.custom_draft_order, false)

    // Start draft
    const { error } = await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })
    assertEquals(error, null)

    // Verify participants have contiguous draft_order 1..N
    const { data: participants } = await client
      .from('league_participants')
      .select('draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(participants)
    const orders = participants.map((p: { draft_order: number }) => p.draft_order)
    assertEquals(orders, [1, 2])

    // Verify custom_draft_order was set to true after auto-randomize
    const { data: leagueAfter } = await client
      .from('leagues')
      .select('custom_draft_order')
      .eq('id', leagueId)
      .single()
    assertEquals(leagueAfter?.custom_draft_order, true)
  })

  await t.step('preserves manual order when custom_draft_order is true', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('preserve-order'))
    await factory.addSecondParticipant(leagueId)

    // Get participants
    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('id', { ascending: true })

    assertExists(participants)
    assertEquals(participants.length, 2)

    // Manually reorder: set P2 first, P1 second
    await client.functions.invoke('update-league', {
      body: {
        action: 'reorder_participants',
        league_id: leagueId,
        participant_order: [participants[1].id, participants[0].id],
      },
    })

    // Verify custom_draft_order is now true
    const { data: leagueBefore } = await client
      .from('leagues')
      .select('custom_draft_order')
      .eq('id', leagueId)
      .single()
    assertEquals(leagueBefore?.custom_draft_order, true)

    // Start draft
    const { error } = await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })
    assertEquals(error, null)

    // Verify P2 is still first, P1 is still second (order preserved)
    const { data: afterParticipants } = await client
      .from('league_participants')
      .select('id, draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(afterParticipants)
    assertEquals(afterParticipants[0].id, participants[1].id) // P2 should be first
    assertEquals(afterParticipants[0].draft_order, 1)
    assertEquals(afterParticipants[1].id, participants[0].id) // P1 should be second
    assertEquals(afterParticipants[1].draft_order, 2)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
