/**
 * Integration tests for update-league Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName } from './_setup.ts'

Deno.test('update-league', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('update-league', {
      body: {
        action: 'update_info',
        league_id: '00000000-0000-0000-0000-000000000000',
        name: 'New Name',
      },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', name: 'New Name' },
    })
    assertEquals(data?.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid UUID format', async () => {
    const { data } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_info',
        league_id: 'not-a-valid-uuid',
        name: 'New Name',
      },
    })
    assertEquals(data?.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid action', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invalid-action'))

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'invalid_action', league_id: leagueId },
    })
    assertEquals(data?.error, 'Invalid action')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const { data } = await client.functions.invoke('update-league', {
      body: {
        action: 'update_info',
        league_id: '00000000-0000-0000-0000-000000000000',
        name: 'New Name',
      },
    })
    assertEquals(data?.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('permission-test'))
    await factory.addSecondParticipant(leagueId)

    const { data } = await secondClient.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, name: 'Hijacked' },
    })
    assertEquals(data?.error, 'Only the league owner can modify settings')
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

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, name: '   ' },
    })
    assertEquals(data?.error, 'League name cannot be empty')
  })

  await t.step('update_info: returns 400 for name over 255 chars', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('long-name'))

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId, name: 'x'.repeat(256) },
    })
    assertEquals(data?.error, 'League name cannot exceed 255 characters')
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

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_info', league_id: leagueId },
    })
    assertEquals(data?.error, 'No valid fields to update')
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

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_draft_config', league_id: leagueId, max_participants: 1 },
    })
    assertEquals(data?.error, 'Max participants must be between 2 and 20')
  })

  await t.step('update_draft_config: returns 400 for max_participants > 20', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('max-participants'))

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_draft_config', league_id: leagueId, max_participants: 21 },
    })
    assertEquals(data?.error, 'Max participants must be between 2 and 20')
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
    const { data: belowData } = await client.functions.invoke('update-league', {
      body: { action: 'update_draft_config', league_id: leagueId, max_participants: 1 },
    })
    assertEquals(belowData?.error, 'Max participants must be between 2 and 20')
  })

  await t.step('update_draft_config: returns 400 when league not in setup status', async () => {
    const leagueId = await factory.createDraftingLeague(uniqueName('drafting-league'))

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'update_draft_config', league_id: leagueId, max_participants: 10 },
    })
    assertEquals(data?.error, 'Draft configuration can only be changed before the draft starts')
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

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'kick_participant', league_id: leagueId, participant_id: owner.id },
    })
    assertEquals(data?.error, 'Cannot remove yourself from the league')
  })

  await t.step('kick_participant: returns 400 for invalid participant_id', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invalid-participant'))

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'kick_participant', league_id: leagueId, participant_id: 'invalid' },
    })
    assertEquals(data?.error, 'Valid participant_id is required')
  })

  await t.step('kick_participant: returns 404 for non-existent participant', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('nonexistent-participant'))

    const { data } = await client.functions.invoke('update-league', {
      body: {
        action: 'kick_participant',
        league_id: leagueId,
        participant_id: '00000000-0000-0000-0000-000000000000',
      },
    })
    assertEquals(data?.error, 'Participant not found')
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

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'kick_participant', league_id: leagueId, participant_id: participant.id },
    })
    assertEquals(data?.error, 'Participants can only be removed before the draft starts')
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

    const { data } = await client.functions.invoke('update-league', {
      body: { action: 'delete_league', league_id: leagueId },
    })
    assertEquals(data?.error, 'League can only be deleted before the draft starts')
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
})
