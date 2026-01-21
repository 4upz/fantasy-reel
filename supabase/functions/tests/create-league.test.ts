/**
 * Integration tests for create-league Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'create-league',
  // Supabase client starts internal intervals for auth refresh that we don't control
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'create-league', { name: 'Test League' })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 when name is missing', async () => {
    const result = await invokeFunction(client, 'create-league', {})
    assertEquals(result.error, 'League name is required')
  })

  await t.step('returns 400 when name is empty string', async () => {
    const result = await invokeFunction(client, 'create-league', { name: '' })
    assertEquals(result.error, 'League name is required')
  })

  await t.step('returns 400 when name is whitespace only', async () => {
    const result = await invokeFunction(client, 'create-league', { name: '   ' })
    assertEquals(result.error, 'League name is required')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('creates league with default options', async () => {
    const leagueName = uniqueName('create-default')

    const { data, error } = await client.functions.invoke('create-league', {
      body: { name: leagueName },
    })

    assertEquals(error, null)
    assertExists(data.league)
    assertExists(data.participant)
    assertExists(data.team)

    assertEquals(data.league.name, leagueName)
    assertEquals(data.league.status, 'setup')
    assertEquals(data.league.invite_only, false)
    assertEquals(data.league.max_participants, 8)

    assertEquals(data.participant.role, 'owner')
    assertEquals(data.participant.status, 'active')
    assertEquals(data.participant.draft_order, 1)

    // Track for cleanup
    factory.trackLeague(data.league.id)
  })

  await t.step('creates league with custom options', async () => {
    const leagueName = uniqueName('create-custom')

    const { data, error } = await client.functions.invoke('create-league', {
      body: {
        name: leagueName,
        invite_only: true,
        max_participants: 4,
        team_name: 'My Custom Team',
      },
    })

    assertEquals(error, null)
    assertEquals(data.league.name, leagueName)
    assertEquals(data.league.invite_only, true)
    assertEquals(data.league.max_participants, 4)
    assertEquals(data.team.name, 'My Custom Team')

    factory.trackLeague(data.league.id)
  })

  await t.step('trims league name', async () => {
    const { data, error } = await client.functions.invoke('create-league', {
      body: { name: '  Trimmed Name  ' },
    })

    assertEquals(error, null)
    assertEquals(data.league.name, 'Trimmed Name')

    factory.trackLeague(data.league.id)
  })

  await t.step('creates default team name from user email', async () => {
    const { data, error } = await client.functions.invoke('create-league', {
      body: { name: uniqueName('create-default-team') },
    })

    assertEquals(error, null)
    assertExists(data.team.name)
    assertEquals(data.team.name.includes('Production Company'), true)

    factory.trackLeague(data.league.id)
  })

  await t.step('sets owner_id to current user', async () => {
    const { data, error } = await client.functions.invoke('create-league', {
      body: { name: uniqueName('create-owner') },
    })

    assertEquals(error, null)
    assertEquals(data.league.owner_id, data.participant.user_id)

    factory.trackLeague(data.league.id)
  })

  await t.step('creates league with draft dates', async () => {
    const startDate = new Date(Date.now() + 86400000).toISOString() // Tomorrow
    const endDate = new Date(Date.now() + 172800000).toISOString() // Day after

    const { data, error } = await client.functions.invoke('create-league', {
      body: {
        name: uniqueName('create-dates'),
        draft_start_date: startDate,
        draft_end_date: endDate,
      },
    })

    assertEquals(error, null)
    assertExists(data.league.draft_start_date)
    assertExists(data.league.draft_end_date)

    factory.trackLeague(data.league.id)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
