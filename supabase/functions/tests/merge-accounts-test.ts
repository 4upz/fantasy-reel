/**
 * Integration tests for merge-accounts Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 *
 * Note: Full account merging tests require OAuth users with Discord identities,
 * which cannot be created programmatically. These tests focus on validation
 * and error handling paths that can be tested with regular users.
 */

import { assertEquals } from '@std/assert'
import { createTestFactory, getAnonClient, getUserId } from './_setup.ts'

Deno.test('merge-accounts', async (t) => {
  const { client, secondClient } = await createTestFactory()
  const userId = await getUserId(client)
  const secondUserId = await getUserId(secondClient)

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const { data } = await anonClient.functions.invoke('merge-accounts', {
      body: {
        originalUserId: '00000000-0000-0000-0000-000000000001',
        duplicateUserId: '00000000-0000-0000-0000-000000000002',
      },
    })
    assertEquals(data?.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 when originalUserId is missing', async () => {
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        duplicateUserId: '00000000-0000-0000-0000-000000000002',
      },
    })
    assertEquals(data?.error, 'Valid originalUserId is required')
  })

  await t.step('returns 400 when originalUserId is invalid UUID', async () => {
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        originalUserId: 'not-a-uuid',
        duplicateUserId: '00000000-0000-0000-0000-000000000002',
      },
    })
    assertEquals(data?.error, 'Valid originalUserId is required')
  })

  await t.step('returns 400 when duplicateUserId is missing', async () => {
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        originalUserId: userId,
      },
    })
    assertEquals(data?.error, 'Valid duplicateUserId is required')
  })

  await t.step('returns 400 when duplicateUserId is invalid UUID', async () => {
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        originalUserId: userId,
        duplicateUserId: 'not-a-uuid',
      },
    })
    assertEquals(data?.error, 'Valid duplicateUserId is required')
  })

  await t.step('returns 400 when trying to merge account with itself', async () => {
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        originalUserId: userId,
        duplicateUserId: userId,
      },
    })
    assertEquals(data?.error, 'Cannot merge an account with itself')
  })

  // ============================================================================
  // Authorization Tests
  // ============================================================================

  await t.step('returns 403 when not signed in as original account', async () => {
    // Second user tries to merge first user's account
    const { data } = await secondClient.functions.invoke('merge-accounts', {
      body: {
        originalUserId: userId, // First user's ID
        duplicateUserId: '00000000-0000-0000-0000-000000000002',
      },
    })
    assertEquals(data?.error, 'You must be signed in as the original account to merge')
  })

  // ============================================================================
  // Not Found Tests
  // ============================================================================

  await t.step('returns 404 when duplicate account does not exist', async () => {
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        originalUserId: userId,
        duplicateUserId: '00000000-0000-0000-0000-000000000099',
      },
    })
    assertEquals(data?.error, 'Duplicate account not found')
  })

  // ============================================================================
  // Business Logic Tests
  // ============================================================================

  await t.step('returns 400 when duplicate account has no Discord identity', async () => {
    // Second user is a regular email user without Discord identity
    const { data } = await client.functions.invoke('merge-accounts', {
      body: {
        originalUserId: userId,
        duplicateUserId: secondUserId,
      },
    })
    assertEquals(data?.error, 'No Discord identity found on duplicate account')
  })

  // ============================================================================
  // Success Path Tests
  // ============================================================================

  // Note: Testing the full success path requires creating OAuth users with
  // Discord identities, which cannot be done programmatically in integration
  // tests. The success path has been manually tested during development.
  //
  // A full success path test would require:
  // 1. Creating a user via Discord OAuth (requires browser interaction)
  // 2. Having them sign up with same email via email/password
  // 3. Calling merge-accounts to transfer the Discord identity
  //
  // For CI/CD purposes, consider using:
  // - Mock testing with stubbed auth.admin functions
  // - A dedicated test environment with pre-created OAuth users
})
