/**
 * Integration tests for join-league Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction, TEST_USER_2 } from './_setup.ts'

Deno.test({
  name: 'join-league',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'join-league', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 when neither league_id nor token provided', async () => {
    const result = await invokeFunction(secondClient, 'join-league', {})
    assertEquals(result.error, 'Either league_id, invitation_token, or join_code is required')
  })

  await t.step('returns 400 for invalid invitation token format', async () => {
    const result = await invokeFunction(secondClient, 'join-league', {
      invitation_token: 'not-a-uuid',
    })
    assertEquals(result.error, 'Invalid invitation token')
  })

  await t.step('returns 400 for invalid league_id format', async () => {
    const result = await invokeFunction(secondClient, 'join-league', {
      league_id: 'not-a-uuid',
    })
    assertEquals(result.error, 'Invalid league_id')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 for non-existent invitation token', async () => {
    const result = await invokeFunction(secondClient, 'join-league', {
      invitation_token: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'Invalid or expired invitation')
  })

  await t.step('returns 404 for non-existent league_id', async () => {
    const result = await invokeFunction(secondClient, 'join-league', {
      league_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'League not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 for invite-only league without token', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-invite-only'), {
      invite_only: true,
    })

    const result = await invokeFunction(secondClient, 'join-league', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'This league is invite-only')
  })

  await t.step('returns 403 when invitation was sent to different email', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-wrong-email'))

    // Create invitation for a different email
    const { token } = await factory.createInvitation(leagueId, 'different@example.com')

    // Second user tries to use the invitation
    const result = await invokeFunction(secondClient, 'join-league', {
      invitation_token: token,
    })
    assertEquals(result.error, 'This invitation was sent to a different email address')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when user is already a member', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-already-member'))
    await factory.addSecondParticipant(leagueId)

    // Try to join again via direct join
    const result = await invokeFunction(secondClient, 'join-league', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'You are already a member of this league')
  })

  await t.step('returns 400 when league is full', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-full'), {
      max_participants: 2,
    })
    await factory.addSecondParticipant(leagueId)

    // Try to create invitation for third user (league is full)
    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      email: 'third@example.com',
    })
    assertEquals(result.error, 'League is full')
  })

  await t.step('returns 400 when invitation already used', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-used-invite'))
    const { token } = await factory.createInvitation(leagueId, TEST_USER_2.email)

    // Second user joins
    await secondClient.functions.invoke('join-league', {
      body: { invitation_token: token },
    })

    // Try to use same token again
    const result = await invokeFunction(secondClient, 'join-league', {
      invitation_token: token,
    })
    assertEquals(result.error, 'Invitation has already been accepted')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('joins league via invitation token', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-via-token'))
    const { token } = await factory.createInvitation(leagueId, TEST_USER_2.email)

    const { data, error } = await secondClient.functions.invoke('join-league', {
      body: { invitation_token: token },
    })

    assertEquals(error, null)
    assertExists(data.participant)
    assertExists(data.team)
    assertExists(data.league)
    assertEquals(data.league.id, leagueId)
    assertEquals(data.participant.role, 'member')
    assertEquals(data.participant.status, 'active')
  })

  await t.step('joins open league directly without invitation', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-open-direct'), {
      invite_only: false,
    })

    const { data, error } = await secondClient.functions.invoke('join-league', {
      body: { league_id: leagueId },
    })

    assertEquals(error, null)
    assertExists(data.participant)
    assertExists(data.team)
    assertEquals(data.league.id, leagueId)
  })

  await t.step('assigns correct draft order', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-draft-order'))
    const { token } = await factory.createInvitation(leagueId, TEST_USER_2.email)

    const { data, error } = await secondClient.functions.invoke('join-league', {
      body: { invitation_token: token },
    })

    assertEquals(error, null)
    // Owner has draft_order 1, second participant should have 2
    assertEquals(data.participant.draft_order, 2)
  })

  await t.step('uses custom team name when provided', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('join-custom-team'))
    const { token } = await factory.createInvitation(leagueId, TEST_USER_2.email)

    const { data, error } = await secondClient.functions.invoke('join-league', {
      body: {
        invitation_token: token,
        team_name: 'My Awesome Team',
      },
    })

    assertEquals(error, null)
    assertEquals(data.team.name, 'My Awesome Team')
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
