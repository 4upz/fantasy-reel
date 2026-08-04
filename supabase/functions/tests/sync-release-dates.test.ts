/**
 * Integration tests for sync-release-dates Edge Function
 *
 * Tests the actual function via direct fetch() with service role auth.
 * Uses real TMDb IDs (like tests/update-scores.test.ts does for MDBList),
 * so this requires TMDB_API_KEY to be configured for the local functions
 * runtime.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sync-release-dates`

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
  name: 'sync-release-dates',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()
    const { factory } = await createTestFactory()

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

      await t.step('succeeds with the service role key when nothing is rostered', async () => {
        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertEquals(typeof data.movies_checked, 'number')
        assertEquals(typeof data.dates_changed, 'number')
        assertEquals(typeof data.leagues_notified, 'number')
      })

      await t.step('detects and corrects a stale release date for a rostered movie', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('sync-release-dates'))

        const { data: picks } = await serviceClient
          .from('draft_picks')
          .select('movie_id, movies(tmdb_id)')
          .eq('league_id', leagueId)
          .limit(1)

        const movieId = picks![0].movie_id
        // TMDb ID 278 = The Shawshank Redemption, real release date 1994-09-23.
        // Point this roster slot at a real, stable movie with a deliberately
        // wrong stored date -- kept within the "recent" cutoff window
        // (today) so the candidate query still picks it up.
        const wrongButRecentDate = new Date().toISOString().split('T')[0]
        await serviceClient
          .from('movies')
          .update({ tmdb_id: 278, release_date: wrongButRecentDate })
          .eq('id', movieId)

        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertEquals(data.movies_checked >= 1, true)
        assertEquals(data.dates_changed >= 1, true)
        assertEquals(data.leagues_notified >= 1, true)

        const { data: updatedMovie } = await serviceClient
          .from('movies')
          .select('release_date')
          .eq('id', movieId)
          .single()

        assertEquals(updatedMovie!.release_date, '1994-09-23')
      })
    } finally {
      await factory.cleanup()
    }
  },
})
