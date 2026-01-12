/**
 * Integration tests for invitation action Edge Functions:
 * - cancel-invitation
 * - decline-invitation
 * - resend-invitation
 *
 * Tests the actual functions via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists, assertNotEquals } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, TEST_USER_2 } from './_setup.ts'

// ============================================================================
// cancel-invitation Tests
// ============================================================================

Deno.test('cancel-invitation', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('cancel-invitation', {
      body: { invitation_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  await t.step('returns 400 for missing invitation_id', async () => {
    const { data } = await client.functions.invoke('cancel-invitation', {
      body: {},
    })
    assertEquals(data?.error, 'Valid invitation_id is required')
  })

  await t.step('returns 404 when invitation does not exist', async () => {
    const { data } = await client.functions.invoke('cancel-invitation', {
      body: { invitation_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Invitation not found')
  })

  await t.step('returns 403 when user is not the league owner', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(uniqueName('cancel-not-owner'))

    const { data } = await secondClient.functions.invoke('cancel-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'Only the league owner can cancel invitations')
  })

  await t.step('cancels invitation successfully', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(uniqueName('cancel-success'))

    const { data, error } = await client.functions.invoke('cancel-invitation', {
      body: { invitation_id: invitationId },
    })

    assertEquals(error, null)
    assertExists(data.invitation)
    assertEquals(data.invitation.status, 'cancelled')
    assertEquals(data.message, 'Invitation cancelled successfully')
  })

  await t.step('returns 400 when invitation already cancelled', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(uniqueName('cancel-already'))

    // Cancel first time
    await client.functions.invoke('cancel-invitation', {
      body: { invitation_id: invitationId },
    })

    // Try to cancel again
    const { data } = await client.functions.invoke('cancel-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'Invitation has already been cancelled')
  })

  await t.step('cleanup', async () => {
    await factory.cleanup()
  })
})

// ============================================================================
// decline-invitation Tests
// ============================================================================

Deno.test('decline-invitation', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('decline-invitation', {
      body: { invitation_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  await t.step('returns 400 for missing invitation_id', async () => {
    const { data } = await secondClient.functions.invoke('decline-invitation', {
      body: {},
    })
    assertEquals(data?.error, 'Valid invitation_id is required')
  })

  await t.step('returns 404 when invitation does not exist', async () => {
    const { data } = await secondClient.functions.invoke('decline-invitation', {
      body: { invitation_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Invitation not found')
  })

  await t.step('returns 403 when invitation was not sent to user', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(
      uniqueName('decline-wrong-user'),
      TEST_USER_2.email
    )

    // First user (not the invitee) tries to decline
    const { data } = await client.functions.invoke('decline-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'This invitation was not sent to you')
  })

  await t.step('declines invitation successfully', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(
      uniqueName('decline-success'),
      TEST_USER_2.email
    )

    const { data, error } = await secondClient.functions.invoke('decline-invitation', {
      body: { invitation_id: invitationId },
    })

    assertEquals(error, null)
    assertExists(data.invitation)
    assertEquals(data.invitation.status, 'declined')
    assertEquals(data.message, 'Invitation declined successfully')
  })

  await t.step('returns 400 when invitation already declined', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(
      uniqueName('decline-already'),
      TEST_USER_2.email
    )

    // Decline first time
    await secondClient.functions.invoke('decline-invitation', {
      body: { invitation_id: invitationId },
    })

    // Try to decline again
    const { data } = await secondClient.functions.invoke('decline-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'Invitation has already been declined')
  })

  await t.step('cleanup', async () => {
    await factory.cleanup()
  })
})

// ============================================================================
// resend-invitation Tests
// ============================================================================

Deno.test('resend-invitation', async (t) => {
  const { client, secondClient, factory } = await createTestFactory()

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('resend-invitation', {
      body: { invitation_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  await t.step('returns 400 for missing invitation_id', async () => {
    const { data } = await client.functions.invoke('resend-invitation', {
      body: {},
    })
    assertEquals(data?.error, 'Valid invitation_id is required')
  })

  await t.step('returns 404 when invitation does not exist', async () => {
    const { data } = await client.functions.invoke('resend-invitation', {
      body: { invitation_id: '00000000-0000-0000-0000-000000000000' },
    })
    assertEquals(data?.error, 'Invitation not found')
  })

  await t.step('returns 403 when user is not the league owner', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(uniqueName('resend-not-owner'))

    const { data } = await secondClient.functions.invoke('resend-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'Only the league owner can resend invitations')
  })

  await t.step('resends invitation with new token', async () => {
    const { invitationId, token: originalToken } = await factory.createLeagueWithInvitation(
      uniqueName('resend-success')
    )

    const { data, error } = await client.functions.invoke('resend-invitation', {
      body: { invitation_id: invitationId },
    })

    assertEquals(error, null)
    assertExists(data.invitation)
    assertEquals(data.invitation.status, 'pending')
    assertNotEquals(data.invitation.token, originalToken)
    assertExists(data.invite_url)
    assertEquals(data.invite_url.includes(data.invitation.token), true)
  })

  await t.step('returns 400 when invitation already accepted', async () => {
    const { leagueId } = await factory.createLeagueWithInvitation(uniqueName('resend-accepted'))

    // Create invitation for second user and have them accept
    const { id: invitationId, token } = await factory.createInvitation(leagueId, TEST_USER_2.email)
    await secondClient.functions.invoke('join-league', {
      body: { invitation_token: token },
    })

    // Try to resend the accepted invitation
    const { data } = await client.functions.invoke('resend-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'Cannot resend - invitation has already been accepted')
  })

  await t.step('returns 400 when invitation was declined', async () => {
    const { invitationId } = await factory.createLeagueWithInvitation(
      uniqueName('resend-declined'),
      TEST_USER_2.email
    )

    // Second user declines
    await secondClient.functions.invoke('decline-invitation', {
      body: { invitation_id: invitationId },
    })

    // Try to resend the declined invitation
    const { data } = await client.functions.invoke('resend-invitation', {
      body: { invitation_id: invitationId },
    })
    assertEquals(data?.error, 'Cannot resend - invitation was declined')
  })

  await t.step('cleanup', async () => {
    await factory.cleanup()
  })
})
