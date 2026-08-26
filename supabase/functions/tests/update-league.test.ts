/**
 * Integration tests for update-league Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assert, assertEquals, assertExists } from '@std/assert'
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

  await t.step('update_bidding_config: updates new_bid_cutoff_hours', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('update-bid-cutoff'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_bidding_config', league_id: leagueId, new_bid_cutoff_hours: 72 },
    })

    assertEquals(error, null)
    assertEquals(data.league.new_bid_cutoff_hours, 72)
  })

  await t.step('update_bidding_config: accepts 0 to disable the new-bid cutoff', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('disable-bid-cutoff'))

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'update_bidding_config', league_id: leagueId, new_bid_cutoff_hours: 0 },
    })

    assertEquals(error, null)
    assertEquals(data.league.new_bid_cutoff_hours, 0)
  })

  await t.step('update_bidding_config: returns 400 for new_bid_cutoff_hours above 144', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('bid-cutoff-too-big'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      new_bid_cutoff_hours: 145,
    })

    assertEquals(result.status, 400)
    assertEquals(String(result.error).includes('between 0 and 144'), true, String(result.error))
  })

  await t.step('update_bidding_config: returns 400 for a negative new_bid_cutoff_hours', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('bid-cutoff-negative'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      new_bid_cutoff_hours: -1,
    })

    assertEquals(result.status, 400)
  })

  await t.step('update_bidding_config: returns 400 for a fractional new_bid_cutoff_hours', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('bid-cutoff-fractional'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_bidding_config',
      league_id: leagueId,
      new_bid_cutoff_hours: 12.5,
    })

    assertEquals(result.status, 400)
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
  // randomize_draft_order Tests
  // ============================================================================

  await t.step('randomize_draft_order: returns 400 when not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('rand-drafting'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'randomize_draft_order',
      league_id: leagueId,
    })
    assertEquals(result.error, 'Draft order can only be randomized before the draft starts')
  })

  await t.step('randomize_draft_order: randomizes order successfully', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('rand-success'))
    await factory.addSecondParticipant(leagueId)

    const { data, error } = await client.functions.invoke('update-league', {
      body: { action: 'randomize_draft_order', league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.message)
    assertEquals(data.message, 'Draft order randomized successfully')
    assertExists(data.participants)
    assertEquals(data.participants.length, 2)
    assertExists(data.participants[0].id)
    assertExists(data.participants[0].draft_order)
  })

  await t.step('randomize_draft_order: sets custom_draft_order flag', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('rand-flag'))
    await factory.addSecondParticipant(leagueId)

    await client.functions.invoke('update-league', {
      body: { action: 'randomize_draft_order', league_id: leagueId },
    })

    const { data: league } = await client
      .from('leagues')
      .select('custom_draft_order')
      .eq('id', leagueId)
      .single()

    assertEquals(league?.custom_draft_order, true)
  })

  await t.step('randomize_draft_order: returns participants sorted by draft_order', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('rand-sorted'))
    await factory.addSecondParticipant(leagueId)

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'randomize_draft_order', league_id: leagueId },
    })

    assertEquals(data.participants.length, 2)
    assertEquals(data.participants[0].draft_order < data.participants[1].draft_order, true)
  })

  await t.step('randomize_draft_order: draft order is contiguous 1..N', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('rand-contiguous'))
    await factory.addSecondParticipant(leagueId)

    await client.functions.invoke('update-league', {
      body: { action: 'randomize_draft_order', league_id: leagueId },
    })

    const { data: participants } = await client
      .from('league_participants')
      .select('draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(participants)
    const orders = participants.map((p: { draft_order: number }) => p.draft_order)
    assertEquals(orders, [1, 2])
  })

  // ============================================================================
  // reorder_participants Tests
  // ============================================================================

  await t.step('reorder_participants: returns 400 when not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('reorder-drafting'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: ['00000000-0000-0000-0000-000000000001'],
    })
    assertEquals(result.error, 'Draft order can only be changed before the draft starts')
  })

  await t.step('reorder_participants: returns 400 for missing participant_order', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-missing'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
    })
    assertEquals(result.error, 'participant_order must be a non-empty array')
  })

  await t.step('reorder_participants: returns 400 for empty array', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-empty'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: [],
    })
    assertEquals(result.error, 'participant_order must be a non-empty array')
  })

  await t.step('reorder_participants: returns 400 for non-array type', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-nonarray'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: 'not-an-array',
    })
    assertEquals(result.error, 'participant_order must be a non-empty array')
  })

  await t.step('reorder_participants: returns 400 for invalid UUIDs', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-invalid-uuid'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: ['not-a-uuid', 'also-not-a-uuid'],
    })
    assertEquals(result.error, 'All participant IDs must be valid UUIDs')
  })

  await t.step('reorder_participants: returns 400 for duplicates', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-dupes'))
    await factory.addSecondParticipant(leagueId)

    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('status', 'active')

    assertExists(participants)
    const firstId = participants[0].id

    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: [firstId, firstId],
    })
    assertEquals(result.error, 'participant_order contains duplicate IDs')
  })

  await t.step('reorder_participants: returns 400 when length mismatches', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-mismatch'))
    await factory.addSecondParticipant(leagueId)

    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('status', 'active')

    assertExists(participants)

    // Send only 1 ID when there are 2 active participants
    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: [participants[0].id],
    })
    assertEquals(result.error, 'participant_order length must match active participant count')
  })

  await t.step('reorder_participants: returns 400 for IDs not in league', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-wrong-ids'))
    await factory.addSecondParticipant(leagueId)

    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('status', 'active')

    assertExists(participants)

    // Replace one ID with a valid UUID that doesn't belong to this league
    const result = await invokeFunction(client, 'update-league', {
      action: 'reorder_participants',
      league_id: leagueId,
      participant_order: [participants[0].id, '00000000-0000-0000-0000-000000000099'],
    })
    assertEquals(result.error, 'Invalid participant IDs provided')
  })

  await t.step('reorder_participants: reorders correctly', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-success'))
    await factory.addSecondParticipant(leagueId)

    // Get current participants sorted by draft_order
    const { data: participants } = await client
      .from('league_participants')
      .select('id, draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(participants)
    assertEquals(participants.length, 2)

    // Reverse the order
    const reversed = [participants[1].id, participants[0].id]

    const { data, error } = await client.functions.invoke('update-league', {
      body: {
        action: 'reorder_participants',
        league_id: leagueId,
        participant_order: reversed,
      },
    })

    assertEquals(error, null)
    assertEquals(data.message, 'Draft order updated successfully')

    // Verify DB state
    const { data: updated } = await client
      .from('league_participants')
      .select('id, draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(updated)
    assertEquals(updated[0].id, participants[1].id) // formerly second is now first
    assertEquals(updated[0].draft_order, 1)
    assertEquals(updated[1].id, participants[0].id) // formerly first is now second
    assertEquals(updated[1].draft_order, 2)
  })

  await t.step('reorder_participants: sets custom_draft_order flag', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-flag'))
    await factory.addSecondParticipant(leagueId)

    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('status', 'active')

    assertExists(participants)

    await client.functions.invoke('update-league', {
      body: {
        action: 'reorder_participants',
        league_id: leagueId,
        participant_order: participants.map((p: { id: string }) => p.id),
      },
    })

    const { data: league } = await client
      .from('leagues')
      .select('custom_draft_order')
      .eq('id', leagueId)
      .single()

    assertEquals(league?.custom_draft_order, true)
  })

  await t.step('reorder_participants: concurrent requests maintain contiguous order', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('reorder-concurrent'))
    await factory.addSecondParticipant(leagueId)

    const { data: participants } = await client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(participants)
    assertEquals(participants.length, 2)

    const order1 = [participants[0].id, participants[1].id]
    const order2 = [participants[1].id, participants[0].id]

    // Fire two concurrent reorder requests
    const [result1, result2] = await Promise.all([
      client.functions.invoke('update-league', {
        body: { action: 'reorder_participants', league_id: leagueId, participant_order: order1 },
      }),
      client.functions.invoke('update-league', {
        body: { action: 'reorder_participants', league_id: leagueId, participant_order: order2 },
      }),
    ])

    // Both should succeed (no partial failure)
    assertEquals(result1.error, null)
    assertEquals(result2.error, null)

    // Final DB state should have contiguous 1..N draft_order
    const { data: finalParticipants } = await client
      .from('league_participants')
      .select('draft_order')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    assertExists(finalParticipants)
    const orders = finalParticipants.map((p: { draft_order: number }) => p.draft_order)
    assertEquals(orders, [1, 2])
  })

  // ============================================================================
  // complete_league (C4: season wrap-up)
  // ============================================================================

  await t.step('complete_league: returns 400 when league is not active', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('complete-setup'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'complete_league',
      league_id: leagueId,
    })

    assertEquals(result.error, 'Only an active league can be marked completed')
  })

  await t.step('complete_league: returns 403 for a non-owner', async () => {
    const leagueId = await factory.createActiveLeague(uniqueName('complete-403'))

    const result = await invokeFunction(secondClient, 'update-league', {
      action: 'complete_league',
      league_id: leagueId,
    })

    assertEquals(result.error, 'Only the league owner can modify settings')
  })

  await t.step('complete_league: transitions an active league to completed and returns top teams', async () => {
    const leagueId = await factory.createActiveLeague(uniqueName('complete-active'))

    const result = await invokeFunction<{
      league: { status: string }
      top_teams: Array<{ teamName: string; points: number }>
    }>(client, 'update-league', { action: 'complete_league', league_id: leagueId })

    assertEquals(result.error, null)
    assertEquals(result.data?.league.status, 'completed')
    assertExists(result.data?.top_teams)

    const { data: updatedLeague } = await client
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()
    assertEquals(updatedLeague?.status, 'completed')
  })

  await t.step('complete_league: cannot be completed twice', async () => {
    const leagueId = await factory.createActiveLeague(uniqueName('complete-twice'))

    const first = await invokeFunction(client, 'update-league', {
      action: 'complete_league',
      league_id: leagueId,
    })
    assertEquals(first.error, null)

    const second = await invokeFunction(client, 'update-league', {
      action: 'complete_league',
      league_id: leagueId,
    })
    assertEquals(second.error, 'Only an active league can be marked completed')
  })

  // ============================================================================
  // update_trade_config Tests
  //
  // The only config action that is NOT gated on `setup` status -- trading
  // happens in an active league, so gating it there would mean these could
  // never be edited when they matter. The active-league step below is the one
  // that would catch a gate being added by reflex.
  // ============================================================================

  await t.step('update_trade_config: updates the expiry bounds together', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-expiry'))

    const { data, error } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      {
        action: 'update_trade_config',
        league_id: leagueId,
        trade_offer_expiry_min_hours: 6,
        trade_offer_expiry_default_hours: 24,
        trade_offer_expiry_max_days: 3,
      },
    )

    assertEquals(error, null)
    assertEquals(data!.league.trade_offer_expiry_min_hours, 6)
    assertEquals(data!.league.trade_offer_expiry_default_hours, 24)
    assertEquals(data!.league.trade_offer_expiry_max_days, 3)
  })

  await t.step('update_trade_config: updates the settings that had no UI before', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-settings'))

    const { data, error } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      {
        action: 'update_trade_config',
        league_id: leagueId,
        trades_enabled: false,
        trade_review_enabled: false,
        trade_veto_hours: 48,
        trade_deadline: '2027-03-01',
      },
    )

    assertEquals(error, null)
    assertEquals(data!.league.trades_enabled, false)
    assertEquals(data!.league.trade_review_enabled, false)
    assertEquals(data!.league.trade_veto_hours, 48)
    assertEquals(data!.league.trade_deadline, '2027-03-01')
  })

  await t.step('update_trade_config: works on an active league', async () => {
    const leagueId = await factory.createActiveLeague(uniqueName('trade-cfg-active'))

    const { data, error } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      {
        action: 'update_trade_config',
        league_id: leagueId,
        trade_deadline: '2027-06-30',
      },
    )

    assertEquals(error, null)
    assertEquals(data!.league.trade_deadline, '2027-06-30')
  })

  await t.step('update_trade_config: a partial update leaves the other fields alone', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-partial'))

    await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_min_hours: 4,
      trade_offer_expiry_default_hours: 12,
    })

    const { data } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      {
        action: 'update_trade_config',
        league_id: leagueId,
        trade_offer_expiry_default_hours: 36,
      },
    )

    assertEquals(data!.league.trade_offer_expiry_default_hours, 36)
    assertEquals(data!.league.trade_offer_expiry_min_hours, 4)
  })

  await t.step('update_trade_config: null restores the app default', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-null'))

    await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_max_days: 3,
    })

    const { data, error } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      {
        action: 'update_trade_config',
        league_id: leagueId,
        trade_offer_expiry_max_days: null,
      },
    )

    assertEquals(error, null)
    assertEquals(data!.league.trade_offer_expiry_max_days, null)
  })

  await t.step('update_trade_config: returns 400 when the minimum exceeds the default', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-min-gt-default'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_min_hours: 72,
      trade_offer_expiry_default_hours: 24,
    })

    assertEquals(result.status, 400)
    assert(
      result.error?.includes('must be between the minimum'),
      `unexpected error: ${result.error}`,
    )
  })

  await t.step('update_trade_config: returns 400 when a narrowed maximum excludes the fallback default', async () => {
    // Nothing in this request is individually out of range -- a 1-day maximum
    // is legal. It is only wrong against the 48h default the league inherits by
    // leaving the column NULL, which is exactly the state the cross-field check
    // exists to catch, and the one a per-field check would miss.
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-max-vs-fallback'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_max_days: 1,
    })

    assertEquals(result.status, 400)
    assert(result.error?.includes('maximum'), `unexpected error: ${result.error}`)
  })

  await t.step('update_trade_config: accepts a narrowed maximum when the default comes down with it', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-max-with-default'))

    const { data, error } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      {
        action: 'update_trade_config',
        league_id: leagueId,
        trade_offer_expiry_max_days: 1,
        trade_offer_expiry_default_hours: 12,
      },
    )

    assertEquals(error, null)
    assertEquals(data!.league.trade_offer_expiry_max_days, 1)
  })

  await t.step('update_trade_config: returns 400 for out-of-range bounds', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-range'))

    const tooBig = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_max_days: 91,
    })
    assertEquals(tooBig.status, 400)
    assert(tooBig.error?.includes('Maximum offer window'), `unexpected error: ${tooBig.error}`)

    const tooSmall = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_min_hours: 0,
    })
    assertEquals(tooSmall.status, 400)
    assert(tooSmall.error?.includes('Minimum offer window'), `unexpected error: ${tooSmall.error}`)

    const fractional = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_default_hours: 12.5,
    })
    assertEquals(fractional.status, 400)
    assert(
      fractional.error?.includes('Default offer window'),
      `unexpected error: ${fractional.error}`,
    )
  })

  await t.step('update_trade_config: returns 400 for an out-of-range veto window', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-veto'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_veto_hours: 200,
    })

    assertEquals(result.status, 400)
    assert(result.error?.includes('Veto window'), `unexpected error: ${result.error}`)
  })

  await t.step('update_trade_config: returns 400 for a trade deadline that is not a bare date', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-deadline'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_deadline: '2027-03-01T12:00:00Z',
    })

    assertEquals(result.status, 400)
    assert(result.error?.includes('YYYY-MM-DD'), `unexpected error: ${result.error}`)
  })

  await t.step('update_trade_config: clears the trade deadline with null', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-deadline-clear'))

    await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_deadline: '2027-03-01',
    })

    const { data, error } = await invokeFunction<{ league: Record<string, unknown> }>(
      client,
      'update-league',
      { action: 'update_trade_config', league_id: leagueId, trade_deadline: null },
    )

    assertEquals(error, null)
    assertEquals(data!.league.trade_deadline, null)
  })

  await t.step('update_trade_config: returns 400 when no fields provided', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('trade-cfg-empty'))

    const result = await invokeFunction(client, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
    })

    assertEquals(result.error, 'No valid fields to update')
  })

  await t.step('update_trade_config: returns 403 for a non-owner', async () => {
    // createActiveLeague, not createLeague: the handler reads the league
    // through the caller's RLS-scoped client, so a non-participant cannot see
    // it at all and gets "League not found" before the owner check is reached.
    // Every sibling non-owner test uses a league the second user belongs to for
    // the same reason. (The 404 is the better answer for a stranger -- it does
    // not confirm the league exists -- so the assertion moves, not the code.)
    const leagueId = await factory.createActiveLeague(uniqueName('trade-cfg-403'))

    const result = await invokeFunction(secondClient, 'update-league', {
      action: 'update_trade_config',
      league_id: leagueId,
      trade_offer_expiry_max_days: 5,
    })

    assertEquals(result.error, 'Only the league owner can modify settings')
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
