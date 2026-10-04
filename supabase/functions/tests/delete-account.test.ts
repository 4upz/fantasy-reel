/**
 * Integration tests for delete-account Edge Function
 *
 * Uses throwaway users: the success path really deletes the account.
 * Requires: npx supabase start && npx supabase functions serve
 *
 * The database side (ownership transfer, former members, scrubbing) is
 * covered by supabase/tests/account_deletion.sql; the 15-minute sign-in
 * window by _shared/recent-auth.test.ts.
 */

import { assert, assertEquals } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnonClient, getServiceClient, invokeFunction, uniqueName } from './_setup.ts'

async function createThrowawayUser(): Promise<{ client: SupabaseClient; userId: string }> {
  const service = getServiceClient()
  const email = `${uniqueName('delete-account').toLowerCase().replace(/[^a-z0-9-]/g, '-')}@example.test`
  const password = 'testpass123!'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`Failed to create throwaway user: ${error?.message}`)

  const client = getAnonClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`Failed to sign in throwaway user: ${signInError.message}`)
  return { client, userId: data.user.id }
}

Deno.test({
  name: 'delete-account',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const service = getServiceClient()
    const { client, userId } = await createThrowawayUser()

    try {
      await t.step('returns 401 when not authenticated', async () => {
        const result = await invokeFunction(getAnonClient(), 'delete-account', { confirmation: 'DELETE' })
        assertEquals(result.error, 'Unauthorized')
      })

      await t.step('requires the typed confirmation', async () => {
        const result = await invokeFunction(client, 'delete-account', { confirmation: 'delete' })
        assertEquals(result.status, 400)
        assertEquals(result.error, 'Type DELETE to confirm')
      })

      await t.step('refuses while the account is in a live draft', async () => {
        const { data: league, error } = await service
          .from('leagues')
          .insert({ name: uniqueName('Delete account draft'), owner_id: userId, status: 'drafting' })
          .select('id')
          .single()
        if (error) throw error

        const result = await invokeFunction(client, 'delete-account', { confirmation: 'DELETE' })
        assertEquals(result.status, 409)
        assert(result.error?.startsWith('Finish the draft in'))

        const { data: stillThere } = await service.auth.admin.getUserById(userId)
        assertEquals(stillThere.user?.id, userId)

        await service.from('leagues').delete().eq('id', league.id)
      })

      await t.step('deletes the account and its profile', async () => {
        const result = await invokeFunction<{ deleted: boolean }>(client, 'delete-account', { confirmation: 'DELETE' })
        assertEquals(result.error, null)
        assertEquals(result.data?.deleted, true)

        const { data } = await service.auth.admin.getUserById(userId)
        assertEquals(data.user, null)
        const { data: profile } = await service.from('profiles').select('id').eq('user_id', userId).maybeSingle()
        assertEquals(profile, null)
      })
    } finally {
      await service.auth.admin.deleteUser(userId).catch(() => undefined)
    }
  },
})
