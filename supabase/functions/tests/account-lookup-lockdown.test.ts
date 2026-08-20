/**
 * Integration tests for the Data API lockdown in
 * 20260820120000_lock_down_account_lookups_and_profiles.sql.
 *
 * Three things must hold against a live PostgREST:
 *   1. count_users_by_email / get_original_user_id -- SECURITY DEFINER readers
 *      of auth.users that take an arbitrary email -- are unreachable with the
 *      public anon key AND with a signed-in user's token. service_role keeps
 *      them (merge-accounts, admin SQL).
 *   2. count_duplicate_accounts_for_current_user() answers for the caller and
 *      nobody else, so a signed-in user may call it.
 *   3. profiles is not readable anonymously, but is readable signed in.
 *
 * These assert on grants and RLS rather than on any Edge Function, because
 * that is exactly the layer that regressed: a blanket
 * `GRANT EXECUTE ON ALL FUNCTIONS ... TO anon` re-opened them.
 *
 * Requires: npx supabase start
 */

import { assert, assertEquals, assertExists } from '@std/assert'
import {
  createTestFactory,
  getAnonClient,
  getServiceClient,
  getUserId,
} from './_setup.ts'

/** Postgres "permission denied for function ..." surfaces as SQLSTATE 42501. */
const INSUFFICIENT_PRIVILEGE = '42501'

Deno.test({
  name: 'account lookup lockdown',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client } = await createTestFactory()
    const anon = getAnonClient()
    const service = getServiceClient()
    const userId = await getUserId(client)

    await t.step('anon cannot call count_users_by_email', async () => {
      const { error } = await anon.rpc('count_users_by_email', {
        email_to_check: 'alice@fantasyreel.test',
      })
      assertExists(error, 'anon must not be able to probe for accounts by email')
      assertEquals(error.code, INSUFFICIENT_PRIVILEGE)
    })

    await t.step('a signed-in user cannot call count_users_by_email', async () => {
      // Holding an account is not a licence to enumerate everyone else's.
      const { error } = await client.rpc('count_users_by_email', {
        email_to_check: 'alice@fantasyreel.test',
      })
      assertExists(error)
      assertEquals(error.code, INSUFFICIENT_PRIVILEGE)
    })

    await t.step('anon cannot call get_original_user_id', async () => {
      const { error } = await anon.rpc('get_original_user_id', {
        email_to_check: 'alice@fantasyreel.test',
        exclude_user_id: '00000000-0000-0000-0000-000000000000',
      })
      assertExists(error, 'anon must not be able to map an email to a user id')
      assertEquals(error.code, INSUFFICIENT_PRIVILEGE)
    })

    await t.step('a signed-in user cannot call get_original_user_id', async () => {
      const { error } = await client.rpc('get_original_user_id', {
        email_to_check: 'alice@fantasyreel.test',
        exclude_user_id: '00000000-0000-0000-0000-000000000000',
      })
      assertExists(error)
      assertEquals(error.code, INSUFFICIENT_PRIVILEGE)
    })

    await t.step('service_role keeps both -- merge-accounts still works', async () => {
      const { error: countError } = await service.rpc('count_users_by_email', {
        email_to_check: 'alice@fantasyreel.test',
      })
      assertEquals(countError, null)

      const { error: lookupError } = await service.rpc('get_original_user_id', {
        email_to_check: 'alice@fantasyreel.test',
        exclude_user_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(lookupError, null)
    })

    await t.step('a signed-in user gets their own duplicate count', async () => {
      const { data, error } = await client.rpc(
        'count_duplicate_accounts_for_current_user'
      )
      assertEquals(error, null)
      // The caller is always one of the rows; >1 is what the OAuth callback
      // treats as a duplicate.
      assert(
        typeof data === 'number' && data >= 1,
        `expected the caller to count themselves, got ${JSON.stringify(data)}`
      )
    })

    await t.step('the self-scoped count returns 0 for an anonymous caller', async () => {
      // auth.uid() is NULL, so the inner lookup yields NULL and nothing
      // matches -- a count, not a leak, even if the grant were widened.
      const { data, error } = await anon.rpc(
        'count_duplicate_accounts_for_current_user'
      )
      if (error) {
        assertEquals(error.code, INSUFFICIENT_PRIVILEGE)
      } else {
        assertEquals(data, 0)
      }
    })

    await t.step('anon cannot read the profiles directory', async () => {
      const { data, error } = await anon.from('profiles').select('user_id, display_name')
      // RLS filters rather than raising: an empty set is the pass condition.
      assertEquals(error, null)
      assertEquals(data?.length ?? 0, 0, 'the user directory must not be public')
    })

    await t.step('a signed-in user can still read profiles', async () => {
      const { data, error } = await client
        .from('profiles')
        .select('user_id, display_name')
        .eq('user_id', userId)
      assertEquals(error, null)
      assertEquals(data?.length, 1, 'authenticated profile reads must keep working')
    })
  },
})
