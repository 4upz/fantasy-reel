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

  await t.step('returns 400 when max_participants is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      max_participants: 1,
    })
    assertEquals(result.error, 'Max participants must be between 2 and 20')
  })

  await t.step('returns 400 when max_participants is above maximum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      max_participants: 21,
    })
    assertEquals(result.error, 'Max participants must be between 2 and 20')
  })

  await t.step('returns 400 when total_slots is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      total_slots: 0,
    })
    assertEquals(result.error, 'Total slots must be between 1 and 20')
  })

  await t.step('returns 400 when total_slots is above maximum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      total_slots: 21,
    })
    assertEquals(result.error, 'Total slots must be between 1 and 20')
  })

  await t.step('returns 400 when draft_slots is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      draft_slots: 0,
    })
    assertEquals(result.error, 'Draft slots must be at least 1')
  })

  await t.step('returns 400 when draft_slots exceeds total_slots', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      total_slots: 5,
      draft_slots: 6,
    })
    assertEquals(result.error, 'Draft slots cannot exceed total slots')
  })

  await t.step('returns 400 when drop_limit is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      drop_limit: -1,
    })
    assertEquals(result.error, 'Drop limit must be between 0 and 10')
  })

  await t.step('returns 400 when drop_limit is above maximum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      drop_limit: 11,
    })
    assertEquals(result.error, 'Drop limit must be between 0 and 10')
  })

  await t.step('returns 400 when counterbid_hours is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      counterbid_hours: 0,
    })
    assertEquals(result.error, 'Counterbid hours must be between 1 and 72')
  })

  await t.step('returns 400 when counterbid_hours is above maximum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      counterbid_hours: 73,
    })
    assertEquals(result.error, 'Counterbid hours must be between 1 and 72')
  })

  await t.step('returns 400 when draft_counterpick_slots is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      draft_counterpick_slots: -1,
    })
    assertEquals(result.error, 'draft_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('returns 400 when draft_counterpick_slots is above maximum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      draft_counterpick_slots: 6,
    })
    assertEquals(result.error, 'draft_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('returns 400 when bidding_counterpick_slots is below minimum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      bidding_counterpick_slots: -1,
    })
    assertEquals(result.error, 'bidding_counterpick_slots must be an integer between 0 and 3')
  })

  await t.step('returns 400 when bidding_counterpick_slots is above maximum', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      bidding_counterpick_slots: 4,
    })
    assertEquals(result.error, 'bidding_counterpick_slots must be an integer between 0 and 3')
  })

  await t.step('returns 400 when counterpicks_block_drops is not a boolean', async () => {
    const result = await invokeFunction(client, 'create-league', {
      name: uniqueName('validation-test'),
      counterpicks_block_drops: 'yes',
    })
    assertEquals(result.error, 'counterpicks_block_drops must be a boolean')
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

  await t.step('creates league with all configuration options', async () => {
    const leagueName = uniqueName('create-full-config')

    const { data, error } = await client.functions.invoke('create-league', {
      body: {
        name: leagueName,
        invite_only: true,
        max_participants: 10,
        team_name: 'Full Config Team',
        total_slots: 8,
        draft_slots: 5,
        drop_limit: 3,
        counterbid_hours: 24,
        draft_counterpick_slots: 2,
        bidding_counterpick_slots: 1,
        counterpicks_block_drops: true,
      },
    })

    assertEquals(error, null)
    assertExists(data.league)
    assertEquals(data.league.name, leagueName)
    assertEquals(data.league.invite_only, true)
    assertEquals(data.league.max_participants, 10)
    assertEquals(data.league.total_slots, 8)
    assertEquals(data.league.draft_slots, 5)
    assertEquals(data.league.drop_limit, 3)
    assertEquals(data.league.counterbid_hours, 24)
    assertEquals(data.league.draft_counterpick_slots, 2)
    assertEquals(data.league.bidding_counterpick_slots, 1)
    assertEquals(data.league.counterpicks_block_drops, true)
    assertEquals(data.team.name, 'Full Config Team')

    factory.trackLeague(data.league.id)
  })

  await t.step('accepts boundary values for all config options', async () => {
    const leagueName = uniqueName('create-boundary')

    const { data, error } = await client.functions.invoke('create-league', {
      body: {
        name: leagueName,
        max_participants: 2, // minimum
        total_slots: 20, // maximum
        draft_slots: 1, // minimum
        drop_limit: 0, // minimum
        counterbid_hours: 72, // maximum
        draft_counterpick_slots: 5, // maximum
        bidding_counterpick_slots: 3, // maximum
        counterpicks_block_drops: false,
      },
    })

    assertEquals(error, null)
    assertExists(data.league)
    assertEquals(data.league.max_participants, 2)
    assertEquals(data.league.total_slots, 20)
    assertEquals(data.league.draft_slots, 1)
    assertEquals(data.league.drop_limit, 0)
    assertEquals(data.league.counterbid_hours, 72)
    assertEquals(data.league.draft_counterpick_slots, 5)
    assertEquals(data.league.bidding_counterpick_slots, 3)
    assertEquals(data.league.counterpicks_block_drops, false)

    factory.trackLeague(data.league.id)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
