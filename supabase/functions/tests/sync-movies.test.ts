/**
 * Integration tests for sync-movies Edge Function auth.
 *
 * sync-movies is operator-only (cron secret or service role key). Only the
 * refusal paths are exercised here: an authorized call spends real TMDb
 * requests and upserts shared movie rows.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import { getAuthenticatedClient } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sync-movies`

Deno.test({
  name: 'sync-movies',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    async function call(headers: Record<string, string>) {
      const response = await fetch(FUNCTION_URL, { method: 'POST', headers, body: '{}' })
      const data = await response.json()
      return { status: response.status, data }
    }

    await t.step('returns 403 with no auth headers', async () => {
      const { status, data } = await call({ 'Content-Type': 'application/json' })
      assertEquals(status, 403)
      assertEquals(data.error, 'Forbidden')
    })

    await t.step('returns 403 with an invalid cron secret', async () => {
      const { status } = await call({ 'X-Cron-Secret': 'nope', 'Content-Type': 'application/json' })
      assertEquals(status, 403)
    })

    await t.step('returns 403 for a signed-in user', async () => {
      const client = await getAuthenticatedClient()
      const { data: { session } } = await client.auth.getSession()
      const { status } = await call({
        Authorization: `Bearer ${session!.access_token}`,
        'Content-Type': 'application/json',
      })
      assertEquals(status, 403)
    })
  },
})
