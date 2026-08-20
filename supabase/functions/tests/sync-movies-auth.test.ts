/**
 * Integration tests for auth on sync-movies.
 *
 * sync-movies is a maintenance endpoint, not a user-facing one: it runs a
 * paginated TMDb discover crawl and writes the results into `movies` with a
 * service-role client. It carries `verify_jwt = false` in config.toml (the
 * CLI's ES256 bug), so its in-handler check is the only thing standing between
 * the public anon key and both the project's TMDb quota and the movies table.
 *
 * It has no programmatic caller -- no Vercel cron entry, no frontend call, no
 * Discord bot call -- so the callers to keep working are the operator ones:
 * `supabase functions invoke` (service role key) and a manual curl carrying
 * X-Cron-Secret. Everyone else gets 403.
 *
 * The success step asserts only that the caller got *past* auth: an unset
 * TMDB_API_KEY (503) or a TMDb rate limit (429) is not an auth regression and
 * must not fail this test.
 *
 * Requires: npx supabase start
 */

import { assertEquals, assertNotEquals } from '@std/assert'
import { getAnonClient, getEdgeFunctionServiceRoleKey, invokeFunction } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_NAME = 'sync-movies'

async function callWithHeaders(
  headers: Record<string, string>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ page: 1 }),
  })
  return { status: response.status, data: await response.json() }
}

Deno.test({
  name: 'sync-movies - auth',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const serviceRoleKey = await getEdgeFunctionServiceRoleKey()

    await t.step('403 with no Authorization header', async () => {
      const { status, data } = await callWithHeaders({})
      assertEquals(status, 403)
      assertEquals(data.error, 'Forbidden')
    })

    await t.step('403 for the bare anon key', async () => {
      // The anon key ships in the browser bundle, so holding it must not be
      // enough to spend TMDb quota or write to `movies`.
      const result = await invokeFunction(getAnonClient(), FUNCTION_NAME, { page: 1 })
      assertEquals(result.error, 'Forbidden')
    })

    await t.step('403 for a wrong cron secret', async () => {
      const { status, data } = await callWithHeaders({ 'X-Cron-Secret': 'nope' })
      assertEquals(status, 403)
      assertEquals(data.error, 'Forbidden')
    })

    await t.step('the service role key is let through', async () => {
      const { status, data } = await callWithHeaders({
        Authorization: `Bearer ${serviceRoleKey}`,
      })
      assertNotEquals(status, 403)
      assertNotEquals(data.error, 'Forbidden')
    })

    await t.step('CORS preflight still works unauthenticated', async () => {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      })
      await response.body?.cancel()
      assertEquals(response.status, 200)
      assertEquals(response.headers.has('Access-Control-Allow-Origin'), true)
    })
  },
})
