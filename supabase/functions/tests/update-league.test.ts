/**
 * Integration tests for update-league Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, invokeFunction, uniqueName } from './_setup.ts'

Deno.test({
  name: 'update-league',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'update-league', {
      action: 'update_info',
      league_id: '00000000-0000-0000-0000-000000000000',
      name: 'New Name',
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const result = await invokeFunction(client, 'update-league', {
      action: 'update_info',
      name: 'New Name',
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid UUID format', async () => {
    const result = await invokeFunction(client, 'update-league', {
      action: 'update_info',
      league_id: 'not-a-valid-uuid',
      name: 'New Name',
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid action', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invalid-action'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'invalid_action',
      league_id: leagueId,
    })
    assertEquals(result.error, 'Invalid action')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const result = await invokeFunction(client, 'update-league', {
      action: 'update_info',
      league_id: '00000000-0000-0000-0000-000000000000',
      name: 'New Name',
    })
    assertEquals(result.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('permission-test'))
    await factory.addSecondParticipant(leagueId)

    const result = await invokeFunction(secondClient, 'update-league', {
      action: 'update_info',
      league_id: leagueId,
      name: 'Hijacked',
    })
    assertEquals(result.error, 'Only the league owner can modify settings')
  })

  // ============================================================================
  // update_info Tests
  // ============================================================================

  await t.step('update_info: updates league name', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-name'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, name: 'Updated League Name' },
    })

    assertEquals(error, null)
    assertExists(data.league)
    assertEquals(data.league.name, 'Updated League Name')
    assertEquals(data.message, 'League updated successfully')
  })

  await t.step('update_info: trims whitespace from name', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trim-name'))

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, name: '  Trimmed Name  ' },
    })

    assertEquals(data.league.name, 'Trimmed Name')
  })

  await t.step('update_info: returns 400 for empty name', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('empty-name'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_info',
      league_id: leagueId,
      name: '   ',
    })
    assertEquals(result.error, 'League name cannot be empty')
  })

  await t.step('update_info: returns 400 for name over 255 chars', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('long-name'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_info',
      league_id: leagueId,
      name: 'x'.repeat(256),
    })
    assertEquals(result.error, 'League name cannot exceed 255 characters')
  })

  await t.step('update_info: toggles invite_only', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('toggle-invite'))

    // Enable invite_only
    const { data: enableData } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, invite_only: true },
    })
    assertEquals(enableData.league.invite_only, true)

    // Disable invite_only
    const { data: disableData } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, invite_only: false },
    })
    assertEquals(disableData.league.invite_only, false)
  })

  await t.step('update_info: updates both name and invite_only', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-both'))

    const { data } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_info',
        league_id: leagueId,
        name: 'Both Updated',
        invite_only: true,
      },
    })

    assertEquals(data.league.name, 'Both Updated')
    assertEquals(data.league.invite_only, true)
  })

  await t.step('update_info: returns 400 when no fields provided', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('no-fields'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_info',
      league_id: leagueId,
    })
    assertEquals(result.error, 'No valid fields to update')
  })

  // ============================================================================
  // update_draft_config Tests
  // ============================================================================

  await t.step('update_draft_config: updates max_participants', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-max'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_draft_config', league_id: leagueId, max_participants: 12 },
    })

    assertEquals(error, null)
    assertEquals(data.league.max_participants, 12)
    assertEquals(data.message, 'Draft configuration updated successfully')
  })

  await t.step('update_draft_config: returns 400 for max_participants < 2', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('min-participants'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_draft_config',
      league_id: leagueId,
      max_participants: 1,
    })
    assertEquals(result.error, 'Max participants must be between 2 and 20')
  })

  await t.step('update_draft_config: returns 400 for max_participants > 20', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('max-participants'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_draft_config',
      league_id: leagueId,
      max_participants: 21,
    })
    assertEquals(result.error, 'Max participants must be between 2 and 20')
  })

  await t.step('update_draft_config: returns 400 if below current participant count', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('below-current'))
    await factory.addSecondParticipant(leagueId)

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_draft_config', league_id: leagueId, max_participants: 2 },
    })
    // Should succeed with exactly 2 participants
    assertEquals(data.league.max_participants, 2)

    // Now try to set it to 1 (below current)
    const belowResult = await invokeFunction(client, 'update-league', {
      action: 'update_draft_config',
      league_id: leagueId,
      max_participants: 1,
    })
    assertEquals(belowResult.error, 'Max participants must be between 2 and 20')
  })

  await t.step('update_draft_config: returns 400 when league not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('drafting-league'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_draft_config',
      league_id: leagueId,
      max_participants: 10,
    })
    assertEquals(result.error, 'Draft configuration can only be changed before the draft starts')
  })

  // ============================================================================
  // update_bidding_config Tests
  // ============================================================================

  await t.step('update_bidding_config: updates total_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-total-slots'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_bidding_config', league_id: leagueId, total_slots: 10 },
    })

    assertEquals(error, null)
    assertEquals(data.league.total_slots, 10)
    assertEquals(data.message, 'Bidding configuration updated successfully')
  })

  await t.step('update_bidding_config: updates draft_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-draft-slots'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_bidding_config', league_id: leagueId, draft_slots: 3 },
    })

    assertEquals(error, null)
    assertEquals(data.league.draft_slots, 3)
  })

  await t.step('update_bidding_config: updates drop_limit', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-drop-limit'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_bidding_config', league_id: leagueId, drop_limit: 5 },
    })

    assertEquals(error, null)
    assertEquals(data.league.drop_limit, 5)
  })

  await t.step('update_bidding_config: updates counterbid_hours', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-counterbid'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_bidding_config', league_id: leagueId, counterbid_hours: 48 },
    })

    assertEquals(error, null)
    assertEquals(data.league.counterbid_hours, 48)
  })

  await t.step('update_bidding_config: updates multiple fields at once', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-all-bidding'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_bidding_config',
        league_id: leagueId,
        total_slots: 12,
        draft_slots: 6,
        drop_limit: 3,
        counterbid_hours: 36,
      },
    })

    assertEquals(error, null)
    assertEquals(data.league.total_slots, 12)
    assertEquals(data.league.draft_slots, 6)
    assertEquals(data.league.drop_limit, 3)
    assertEquals(data.league.counterbid_hours, 36)
  })

  await t.step('update_bidding_config: returns 400 for total_slots < 1', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('total-slots-min'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      total_slots: 0,
    })
    assertEquals(result.error, 'Total slots must be between 1 and 20')
  })

  await t.step('update_bidding_config: returns 400 for total_slots > 20', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('total-slots-max'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      total_slots: 21,
    })
    assertEquals(result.error, 'Total slots must be between 1 and 20')
  })

  await t.step('update_bidding_config: returns 400 for draft_slots < 1', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('draft-slots-min'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      draft_slots: 0,
    })
    assertEquals(result.error, 'Draft slots must be at least 1')
  })

  await t.step('update_bidding_config: returns 400 when draft_slots > total_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('draft-exceeds-total'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      total_slots: 5,
      draft_slots: 6,
    })
    assertEquals(result.error, 'Draft slots cannot exceed total slots')
  })

  await t.step('update_bidding_config: returns 400 for drop_limit < 0', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('drop-limit-min'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      drop_limit: -1,
    })
    assertEquals(result.error, 'Drop limit must be between 0 and 10')
  })

  await t.step('update_bidding_config: returns 400 for drop_limit > 10', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('drop-limit-max'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      drop_limit: 11,
    })
    assertEquals(result.error, 'Drop limit must be between 0 and 10')
  })

  await t.step('update_bidding_config: returns 400 for counterbid_hours < 1', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('counterbid-min'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      counterbid_hours: 0,
    })
    assertEquals(result.error, 'Counterbid hours must be between 1 and 72')
  })

  await t.step('update_bidding_config: returns 400 for counterbid_hours > 72', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('counterbid-max'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      counterbid_hours: 73,
    })
    assertEquals(result.error, 'Counterbid hours must be between 1 and 72')
  })

  await t.step('update_bidding_config: returns 400 when no fields provided', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('no-bidding-fields'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
    })
    assertEquals(result.error, 'No valid fields to update')
  })

  await t.step('update_bidding_config: returns 400 when league not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('bidding-drafting'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      total_slots: 10,
    })
    assertEquals(result.error, 'Bidding configuration can only be changed before the draft starts')
  })

  // ============================================================================
  // kick_participant Tests
  // ============================================================================

  await t.step('kick_participant: removes participant from league', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('kick-test'))
    await factory.addSecondParticipant(leagueId)

    // Get second participant's ID
    const { data: participant } = await client
      .from('league_participants')
      .select('id, user_id')
      .eq('league_id', leagueId)
      .neq('role', 'owner')
      .single()

    assertExists(participant, 'Participant should exist')

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'kick_participant', league_id: leagueId, participant_id: participant.id },
    })

    assertEquals(error, null)
    assertExists(data.message)

    // Verify participant status is 'kicked'
    const { data: kicked } = await client
      .from('league_participants')
      .select('status')
      .eq('id', participant.id)
      .single()
    assertEquals(kicked?.status, 'kicked')
  })

  await t.step('kick_participant: returns 400 when trying to kick self', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('kick-self'))

    // Get owner's participant ID
    const { data: owner } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('role', 'owner')
      .single()

    assertExists(owner, 'Owner should exist')

    const result = await invokeFunction(client, 'update-league', {
      action: 'kick_participant',
      league_id: leagueId,
      participant_id: owner.id,
    })
    assertEquals(result.error, 'Cannot remove yourself from the league')
  })

  await t.step('kick_participant: returns 400 for invalid participant_id', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invalid-participant'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'kick_participant',
      league_id: leagueId,
      participant_id: 'invalid',
    })
    assertEquals(result.error, 'Valid participant_id is required')
  })

  await t.step('kick_participant: returns 404 for non-existent participant', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('nonexistent-participant'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'kick_participant',
      league_id: leagueId,
      participant_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'Participant not found')
  })

  await t.step('kick_participant: returns 400 when league not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('kick-drafting'))

    // Get second participant's ID
    const { data: participant } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .neq('role', 'owner')
      .single()

    assertExists(participant, 'Participant should exist')

    const result = await invokeFunction(client, 'update-league', {
      action: 'kick_participant',
      league_id: leagueId,
      participant_id: participant.id,
    })
    assertEquals(result.error, 'Participants can only be removed before the draft starts')
  })

  // ============================================================================
  // delete_league Tests
  // ============================================================================

  await t.step('delete_league: deletes league and related data', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('delete-test'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'delete_league', league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.message)

    // Verify league is deleted
    const { data: deleted } = await client
      .from('leagues')
      .select('id')
      .eq('id', leagueId)
      .maybeSingle()
    assertEquals(deleted, null)
  })

  await t.step('delete_league: returns 400 when league not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('delete-drafting'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'delete_league',
      league_id: leagueId,
    })
    assertEquals(result.error, 'League can only be deleted before the draft starts')
  })

  // ============================================================================
  // update_counterpick_config Tests
  // ============================================================================

  await t.step('update_counterpick_config: updates draft_counterpick_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-draft-slots'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_counterpick_config',
        league_id: leagueId,
        draft_counterpick_slots: 2,
      },
    })

    assertEquals(error, null)
    assertEquals(data.league.draft_counterpick_slots, 2)
    assertEquals(data.message, 'Counterpick configuration updated successfully')
  })

  await t.step('update_counterpick_config: updates bidding_counterpick_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-bidding-slots'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_counterpick_config',
        league_id: leagueId,
        bidding_counterpick_slots: 1,
      },
    })

    assertEquals(error, null)
    assertEquals(data.league.bidding_counterpick_slots, 1)
  })

  await t.step('update_counterpick_config: updates counterpicks_block_drops', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-block-drops'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_counterpick_config',
        league_id: leagueId,
        counterpicks_block_drops: false,
      },
    })

    assertEquals(error, null)
    assertEquals(data.league.counterpicks_block_drops, false)
  })

  await t.step('update_counterpick_config: updates multiple fields at once', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-multiple'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_counterpick_config',
        league_id: leagueId,
        draft_counterpick_slots: 3,
        bidding_counterpick_slots: 2,
        counterpicks_block_drops: true,
      },
    })

    assertEquals(error, null)
    assertEquals(data.league.draft_counterpick_slots, 3)
    assertEquals(data.league.bidding_counterpick_slots, 2)
    assertEquals(data.league.counterpicks_block_drops, true)
  })

  await t.step('update_counterpick_config: returns 400 for draft_counterpick_slots < 0', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-draft-min'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      draft_counterpick_slots: -1,
    })

    assertEquals(result.error, 'draft_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('update_counterpick_config: returns 400 for draft_counterpick_slots > 5', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-draft-max'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      draft_counterpick_slots: 6,
    })

    assertEquals(result.error, 'draft_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('update_counterpick_config: returns 400 for bidding_counterpick_slots < 0', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-bidding-min'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      bidding_counterpick_slots: -1,
    })

    assertEquals(result.error, 'bidding_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('update_counterpick_config: returns 400 for bidding_counterpick_slots > 5', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-bidding-max'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      bidding_counterpick_slots: 6,
    })

    assertEquals(result.error, 'bidding_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('update_counterpick_config: returns 400 for no fields provided', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-no-fields'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
    })

    assertEquals(result.error, 'No counterpick config fields provided')
  })

  await t.step('update_counterpick_config: returns 400 for non-boolean counterpicks_block_drops', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-invalid-bool'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      counterpicks_block_drops: 'true', // string instead of boolean
    })

    assertEquals(result.error, 'counterpicks_block_drops must be a boolean')
  })

  await t.step('update_counterpick_config: returns 400 for non-integer draft_counterpick_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-decimal'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      draft_counterpick_slots: 2.5,
    })

    assertEquals(result.error, 'draft_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('update_counterpick_config: returns 400 for non-integer bidding_counterpick_slots', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('cp-bidding-decimal'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      bidding_counterpick_slots: 1.5,
    })

    assertEquals(result.error, 'bidding_counterpick_slots must be an integer between 0 and 5')
  })

  await t.step('update_counterpick_config: returns 400 when league not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('cp-drafting'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_counterpick_config',
      league_id: leagueId,
      draft_counterpick_slots: 2,
    })

    assertEquals(result.error, 'Counterpick configuration can only be changed before the draft starts')
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
