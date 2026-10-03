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
import {
  createTestFactory,
  getAnonClient,
  getServiceClient,
  getUserId,
  invokeFunction,
} from './_setup.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

async function getAccessToken(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('Test client has no session')
  return data.session.access_token
}

Deno.test({
  name: 'merge-accounts',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
  const { client, secondClient } = await createTestFactory()
  const userId = await getUserId(client)
  const secondUserId = await getUserId(secondClient)
  const firstToken = await getAccessToken(client)
  const secondToken = await getAccessToken(secondClient)

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  await t.step('returns 401 when not authenticated', async () => {
    const anonClient = getAnonClient()
    const result = await invokeFunction(anonClient, 'merge-accounts', {
      originalUserId: '00000000-0000-0000-0000-000000000001',
      duplicateUserId: '00000000-0000-0000-0000-000000000002',
    })
    assertEquals(result.error, 'Unauthorized')
  })

  // ============================================================================
  // Validation Tests
  // ============================================================================

  await t.step('returns 400 when originalUserId is missing', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      duplicateUserId: '00000000-0000-0000-0000-000000000002',
    })
    assertEquals(result.error, 'Valid originalUserId is required')
  })

  await t.step('returns 400 when originalUserId is invalid UUID', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: 'not-a-uuid',
      duplicateUserId: '00000000-0000-0000-0000-000000000002',
    })
    assertEquals(result.error, 'Valid originalUserId is required')
  })

  await t.step('returns 400 when duplicateUserId is missing', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
    })
    assertEquals(result.error, 'Valid duplicateUserId is required')
  })

  await t.step('returns 400 when duplicateUserId is invalid UUID', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: 'not-a-uuid',
    })
    assertEquals(result.error, 'Valid duplicateUserId is required')
  })

  await t.step('returns 400 when provider is missing', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: '00000000-0000-0000-0000-000000000002',
    })
    assertEquals(result.error, 'Valid provider is required (discord or google)')
  })

  await t.step('returns 400 when provider is invalid', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: '00000000-0000-0000-0000-000000000002',
      provider: 'invalid',
    })
    assertEquals(result.error, 'Valid provider is required (discord or google)')
  })

  await t.step('returns 400 when trying to merge account with itself', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: userId,
      provider: 'discord',
    })
    assertEquals(result.error, 'Cannot merge an account with itself')
  })

  await t.step('returns 400 when duplicateAccessToken is missing', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: secondUserId,
      provider: 'discord',
    })
    assertEquals(result.error, 'duplicateAccessToken is required')
  })

  // ============================================================================
  // Authorization Tests
  // ============================================================================

  await t.step('returns 403 when not signed in as original account', async () => {
    // Second user tries to merge first user's account
    const result = await invokeFunction(secondClient, 'merge-accounts', {
      originalUserId: userId, // First user's ID
      duplicateUserId: '00000000-0000-0000-0000-000000000002',
      duplicateAccessToken: secondToken,
      provider: 'discord',
    })
    assertEquals(result.error, 'You must be signed in as the original account to merge')
  })

  await t.step('returns 403 when the token does not belong to the duplicate account', async () => {
    // The takeover: name a victim's id while proving only your own session.
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: secondUserId,
      duplicateAccessToken: firstToken,
      provider: 'discord',
    })
    assertEquals(result.error, 'Could not verify the account to link. Please sign in again.')
  })

  await t.step('returns 403 when the token is not a valid session', async () => {
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: '00000000-0000-0000-0000-000000000099',
      duplicateAccessToken: 'not-a-jwt',
      provider: 'discord',
    })
    assertEquals(result.error, 'Could not verify the account to link. Please sign in again.')
  })

  await t.step('returns 403 when the duplicate account has a different email', async () => {
    // Even holding both sessions, unrelated accounts are never merged.
    const result = await invokeFunction(client, 'merge-accounts', {
      originalUserId: userId,
      duplicateUserId: secondUserId,
      duplicateAccessToken: secondToken,
      provider: 'discord',
    })
    assertEquals(result.error, 'Accounts can only be linked when their emails match')
  })

  await t.step('leaves the named account in place after a refused merge', async () => {
    const { data, error } = await getServiceClient().auth.admin.getUserById(secondUserId)
    assertEquals(error, null)
    assertEquals(data.user?.id, secondUserId)
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
}})
