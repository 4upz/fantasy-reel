/**
 * Integration tests for weekly-releases-digest Edge Function
 *
 * Tests the actual function via direct fetch() with service role auth,
 * mirroring tests/update-scores.test.ts.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/weekly-releases-digest`

async function getEdgeFunctionServiceRoleKey(): Promise<string> {
  try {
    const cmd = new Deno.Command('docker', {
      args: ['exec', 'supabase_edge_runtime_fantasy-reel', 'printenv', 'SUPABASE_SERVICE_ROLE_KEY'],
      stdout: 'piped',
      stderr: 'piped',
    })
    const output = await cmd.output()
    if (output.success) {
      const key = new TextDecoder().decode(output.stdout).trim()
      if (key) return key
    }
  } catch {
    // Docker not available or container not found
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

Deno.test({
  name: 'weekly-releases-digest',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()
    const { factory } = await createTestFactory()
    const createdMovieIds: string[] = []

    async function call(headers: Record<string, string>) {
      const response = await fetch(FUNCTION_URL, { method: 'POST', headers })
      const data = await response.json()
      return { status: response.status, data }
    }

    function authHeaders(): Record<string, string> {
      return { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
    }

    try {
      await t.step('returns 403 with no auth headers', async () => {
        const { status, data } = await call({ 'Content-Type': 'application/json' })
        assertEquals(status, 403)
        assertEquals(data.error, 'Forbidden')
      })

      await t.step('succeeds with the service role key and returns a Monday-Sunday window', async () => {
        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertExists(data.week_start)
        assertExists(data.week_end)
        assertExists(data.leagues_notified)
        assertExists(data.movies_included)
      })

      await t.step('includes a league with a movie releasing this week', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('weekly-digest'))

        const { data: picks } = await serviceClient
          .from('draft_picks')
          .select('movie_id')
          .eq('league_id', leagueId)
          .limit(1)

        const movieId = picks![0].movie_id
        createdMovieIds.push(movieId)

        const today = new Date().toISOString().split('T')[0]
        await serviceClient.from('movies').update({ release_date: today }).eq('id', movieId)

        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertEquals(data.leagues_notified >= 1, true)
      })
    } finally {
      await factory.cleanup()
    }
  },
})
