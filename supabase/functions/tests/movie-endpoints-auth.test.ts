/**
 * Integration tests for auth on the three read-only TMDb Edge Functions:
 * browse-movies, search-movies, get-movie-details.
 *
 * All three carry `verify_jwt = false` in config.toml (the CLI's ES256 bug),
 * so nothing but their in-handler check stands between the public anon key and
 * the project's TMDb quota. Two callers must get through -- a signed-in user
 * (the frontend, via callEdgeFunction) and the service role key (the Discord
 * bot, apps/discord-bot/src/utils/functions-client.ts) -- and nobody else.
 *
 * Success steps assert only that the caller got *past* auth, not that TMDb
 * answered: a rate limit or an unset TMDB_API_KEY is not an auth regression,
 * and these tests must not start failing for it.
 *
 * Requires: npx supabase start
 */

import { assertEquals, assertNotEquals } from '@std/assert'
import {
  createTestFactory,
  getAnonClient,
  getEdgeFunctionServiceRoleKey,
  invokeFunction,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'

/** The three endpoints and a minimal valid body for each. */
const ENDPOINTS: Array<{ name: string; body: Record<string, unknown> }> = [
  { name: 'browse-movies', body: {} },
  { name: 'search-movies', body: { query: 'dune' } },
  // A real TMDb id (Dune: Part Two) so the request can reach a 200 rather than
  // a 404 -- either way it proves auth let the caller through.
  { name: 'get-movie-details', body: { tmdb_id: 693134 } },
]

async function callWithHeaders(
  functionName: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

Deno.test({
  name: 'movie endpoints - auth',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client } = await createTestFactory()
    const serviceRoleKey = await getEdgeFunctionServiceRoleKey()

    for (const { name, body } of ENDPOINTS) {
      await t.step(`${name} - 401 with no Authorization header`, async () => {
        const { status, data } = await callWithHeaders(name, {}, body)
        assertEquals(status, 401)
        assertEquals(data.error, 'Unauthorized')
      })

      await t.step(`${name} - 401 with an invalid bearer token`, async () => {
        const { status, data } = await callWithHeaders(name, { Authorization: 'Bearer nope' }, body)
        assertEquals(status, 401)
        assertEquals(data.error, 'Unauthorized')
      })

      await t.step(`${name} - 401 for the bare anon key`, async () => {
        // The anon key is public (it ships in the browser bundle), so holding
        // it must not be enough to spend TMDb quota.
        const result = await invokeFunction(getAnonClient(), name, body)
        assertEquals(result.error, 'Unauthorized')
      })

      await t.step(`${name} - a signed-in user is let through`, async () => {
        const result = await invokeFunction(client, name, body)
        assertNotEquals(result.error, 'Unauthorized')
        assertNotEquals(result.status, 401)
      })

      await t.step(`${name} - the service role key is let through`, async () => {
        const { status, data } = await callWithHeaders(
          name,
          { Authorization: `Bearer ${serviceRoleKey}` },
          body
        )
        assertNotEquals(status, 401)
        assertNotEquals(data.error, 'Unauthorized')
      })

      await t.step(`${name} - CORS preflight still works unauthenticated`, async () => {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
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
    }
  },
})
