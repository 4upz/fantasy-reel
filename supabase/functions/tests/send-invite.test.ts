/**
 * Integration tests for send-invite Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import {
  createTestFactory,
  getAnonClient,
  getUserId,
  uniqueName,
  invokeFunction,
  TEST_USER,
  TEST_USER_2,
} from './_setup.ts'

Deno.test({
  name: 'send-invite',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'send-invite', {
      league_id: '00000000-0000-0000-0000-000000000000',
      email: 'invitee@example.com',
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 for missing league_id', async () => {
    const result = await invokeFunction(client, 'send-invite', {
      email: 'invitee@example.com',
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 for invalid league_id', async () => {
    const result = await invokeFunction(client, 'send-invite', {
      league_id: 'not-a-uuid',
      email: 'invitee@example.com',
    })
    assertEquals(result.error, 'Valid league_id is required')
  })

  await t.step('returns 400 when neither email nor user_id provided', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-no-email'))

    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
    })
    assertEquals(result.error, 'Either email or user_id is required')
  })

  await t.step('returns 400 for invalid email format', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-invalid-email'))

    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      email: 'not-an-email',
    })
    assertEquals(result.error, 'Valid email is required')
  })

  await t.step('returns 400 when trying to invite yourself', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-self'))

    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      email: TEST_USER.email,
    })
    assertEquals(result.error, 'You cannot invite yourself to a league')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when league does not exist', async () => {
    const result = await invokeFunction(client, 'send-invite', {
      league_id: '00000000-0000-0000-0000-000000000000',
      email: 'invitee@example.com',
    })
    assertEquals(result.error, 'League not found')
  })

  await t.step('returns 404 for invalid user_id', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-invalid-userid'))

    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      user_id: '00000000-0000-0000-0000-000000000000',
    })
    assertEquals(result.error, 'User not found')
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  await t.step('returns 403 when user is not the league owner', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-not-owner'))
    // Add second user to league so they can see it via RLS
    await factory.addSecondParticipant(leagueId)

    const result = await invokeFunction(secondClient, 'send-invite', {
      league_id: leagueId,
      email: 'some-invitee@example.com',
    })
    assertEquals(result.error, 'Only the league owner can send invitations')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when draft has already started', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-drafting'))
    await factory.addSecondParticipant(leagueId)

    // Start the draft
    await client.functions.invoke('start-draft', {
      body: { league_id: leagueId },
    })

    // Try to send another invite
    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      email: 'another@example.com',
    })
    assertEquals(result.error, 'Cannot send invitations - draft has already started')
  })

  await t.step('returns 400 when invitation already pending', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-duplicate'))

    // Send first invitation
    await client.functions.invoke('send-invite', {
      body: { league_id: leagueId, email: 'duplicate@example.com' },
    })

    // Try to send duplicate invitation
    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      email: 'duplicate@example.com',
    })
    assertEquals(result.error, 'An invitation has already been sent to this email')
  })

  await t.step('returns 400 when user already joined', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-already-joined'))
    await factory.addSecondParticipant(leagueId)

    // Try to invite same user again
    const result = await invokeFunction(client, 'send-invite', {
      league_id: leagueId,
      email: TEST_USER_2.email,
    })
    assertEquals(result.error, 'This user has already joined the league')
  })

  // ============================================================================
  // Success Tests
  // ============================================================================

  await t.step('creates invitation on success', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-success'))

    const { data, error } = await client.functions.invoke('send-invite', {
      body: { league_id: leagueId, email: 'new-invitee@example.com' },
    })

    assertEquals(error, null)
    assertExists(data.invitation)
    assertEquals(data.invitation.league_id, leagueId)
    assertEquals(data.invitation.email, 'new-invitee@example.com')
    assertEquals(data.invitation.status, 'pending')
    assertExists(data.invitation.token)
    assertExists(data.invite_url)
    assertEquals(data.invite_url.includes(data.invitation.token), true)
  })

  await t.step('normalizes email to lowercase', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-lowercase'))

    const { data, error } = await client.functions.invoke('send-invite', {
      body: { league_id: leagueId, email: 'UPPERCASE@EXAMPLE.COM' },
    })

    assertEquals(error, null)
    assertEquals(data.invitation.email, 'uppercase@example.com')
  })

  await t.step('can invite by user_id', async () => {
    const { id: leagueId } = await factory.createLeague(uniqueName('invite-by-userid'))
    const secondUserId = await getUserId(secondClient)

    const { data, error } = await client.functions.invoke('send-invite', {
      body: { league_id: leagueId, user_id: secondUserId },
    })

    assertEquals(error, null)
    assertExists(data.invitation)
    assertEquals(data.invitation.email, TEST_USER_2.email)
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  await t.step('cleanup test data', async () => {
    await factory.cleanup()
  })
}})
