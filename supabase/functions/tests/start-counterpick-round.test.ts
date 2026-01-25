/**
 * Integration tests for start-counterpick-round Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, getServiceClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'start-counterpick-round',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()
  const serviceClient = getServiceClient()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'start-counterpick-round', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const result = await invokeFunction(client, 'start-counterpick-round', {})
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid UUID format', async () => {
    const result = await invokeFunction(client, 'start-counterpick-round', {
      league_id: 'not-a-valid-uuid',
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const result = await invokeFunction(client, 'start-counterpick-round', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('permission-cp'))

    const result = await invokeFunction(secondClient, 'start-counterpick-round', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'Only the league owner can start the counterpick round')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when league is in setup status', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('setup-status'))
    await factory.addSecondParticipant(leagueId)

    const result = await invokeFunction(client, 'start-counterpick-round', {
      league_id: leagueId,
    })
    assertEquals(result.error, "Cannot start counterpick round: league is in 'setup' status")
  })

  await t.step('returns 400 when league is already in counterpicking status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('already-cp'))

    // Start counterpick round first time
    await client.functions.invoke('start-counterpick-round', {
      body: { league_id: leagueId },
    })

    // Try to start counterpick round again
    const result = await invokeFunction(client, 'start-counterpick-round', {
      league_id: leagueId,
    })
    assertEquals(result.error, "Cannot start counterpick round: league is in 'counterpicking' status")
  })

  await t.step('returns 400 when league has no counterpick slots configured', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('no-cp-slots'))

    // Set counterpick slots to 0
    await serviceClient
      .from('leagues')
      .update({ draft_counterpick_slots: 0 })
      .eq('id', leagueId)

    const result = await invokeFunction(client, 'start-counterpick-round', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'League has no counterpick slots configured')
  })

  await t.step('returns 400 when draft_counterpick_slots is null', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('null-slots'))

    // Explicitly set to null
    await serviceClient
      .from('leagues')
      .update({ draft_counterpick_slots: null })
      .eq('id', leagueId)

    const result = await invokeFunction(client, 'start-counterpick-round', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'League has no counterpick slots configured')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('returns 200 and updates status on success', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('cp-success'))

    // Ensure counterpick slots are configured (default should be 1)
    await serviceClient
      .from('leagues')
      .update({ draft_counterpick_slots: 1 })
      .eq('id', leagueId)

    const { data, error } = await client.functions.invoke('start-counterpick-round', {
      body: { league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.league)
    assertEquals(data.league.status, 'counterpicking')
    assertEquals(data.message, 'Counterpick round started')
    // first_pick should be present when counterpick slots are configured
    assertExists(data.first_pick)
  })

  await t.step('returns first pick info with correct fields', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('cp-first-pick'))

    await serviceClient
      .from('leagues')
      .update({ draft_counterpick_slots: 2 })
      .eq('id', leagueId)

    const { data, error } = await client.functions.invoke('start-counterpick-round', {
      body: { league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.first_pick)
    // Verify first_pick has expected fields from get_next_counterpick_turn
    assertEquals(data.first_pick.round, 1)
    assertExists(data.first_pick.pick_number)
    assertExists(data.first_pick.team_id)
    assertExists(data.first_pick.participant_id)
    assertExists(data.first_pick.user_id)
    assertExists(data.first_pick.counterpicks_remaining)
    assertEquals(data.first_pick.counterpicks_remaining, 2) // 2 slots configured
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
