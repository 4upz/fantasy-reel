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
import { createTestFactory, getAnonClient, uniqueName, TEST_USER_2, invokeFunction } from './_setup.ts'

// ============================================================================
// cancel-invitation Tests
// ============================================================================

Deno.test({
  name: 'cancel-invitation',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'cancel-invitation', {
        invitation_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for missing invitation_id', async () => {
      const result = await invokeFunction(client, 'cancel-invitation', {})
      assertEquals(result.error, 'Valid invitation_id is required')
    })

    await t.step('returns 404 when invitation does not exist', async () => {
      const result = await invokeFunction(client, 'cancel-invitation', {
        invitation_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Invitation not found')
    })

    await t.step('returns 403 when user is not the league owner', async () => {
      // Send invitation to TEST_USER_2 so they can see it via RLS
      const { invitationId } = await factory.createLeagueWithInvitation(
        uniqueName('cancel-not-owner'),
        TEST_USER_2.email
      )

      const result = await invokeFunction(secondClient, 'cancel-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'Only the league owner can cancel invitations')
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
      const result = await invokeFunction(client, 'cancel-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'Invitation has already been cancelled')
    })

    await t.step('cleanup', async () => {
      await factory.cleanup()
    })
  },
})

// ============================================================================
// decline-invitation Tests
// ============================================================================

Deno.test({
  name: 'decline-invitation',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'decline-invitation', {
        invitation_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for missing invitation_id', async () => {
      const result = await invokeFunction(secondClient, 'decline-invitation', {})
      assertEquals(result.error, 'Valid invitation_id is required')
    })

    await t.step('returns 404 when invitation does not exist', async () => {
      const result = await invokeFunction(secondClient, 'decline-invitation', {
        invitation_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Invitation not found')
    })

    await t.step('returns 403 when invitation was not sent to user', async () => {
      const { invitationId } = await factory.createLeagueWithInvitation(
        uniqueName('decline-wrong-user'),
        TEST_USER_2.email
      )

      // First user (not the invitee) tries to decline
      const result = await invokeFunction(client, 'decline-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'This invitation was not sent to you')
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
      const result = await invokeFunction(secondClient, 'decline-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'Invitation has already been declined')
    })

    await t.step('cleanup', async () => {
      await factory.cleanup()
    })
  },
})

// ============================================================================
// resend-invitation Tests
// ============================================================================

Deno.test({
  name: 'resend-invitation',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'resend-invitation', {
        invitation_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for missing invitation_id', async () => {
      const result = await invokeFunction(client, 'resend-invitation', {})
      assertEquals(result.error, 'Valid invitation_id is required')
    })

    await t.step('returns 404 when invitation does not exist', async () => {
      const result = await invokeFunction(client, 'resend-invitation', {
        invitation_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Invitation not found')
    })

    await t.step('returns 403 when user is not the league owner', async () => {
      // Send invitation to TEST_USER_2 so they can see it via RLS
      const { invitationId } = await factory.createLeagueWithInvitation(
        uniqueName('resend-not-owner'),
        TEST_USER_2.email
      )

      const result = await invokeFunction(secondClient, 'resend-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'Only the league owner can resend invitations')
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
      const result = await invokeFunction(client, 'resend-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'Cannot resend - invitation has already been accepted')
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

      // Owner tries to resend the declined invitation
      const result = await invokeFunction(client, 'resend-invitation', {
        invitation_id: invitationId,
      })
      assertEquals(result.error, 'Cannot resend - invitation was declined')
    })

    await t.step('cleanup', async () => {
      await factory.cleanup()
    })
  },
})
