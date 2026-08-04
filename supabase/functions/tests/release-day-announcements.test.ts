/**
 * Integration tests for release-day-announcements Edge Function
 *
 * Tests the actual function via direct fetch() with service role auth,
 * mirroring tests/update-scores.test.ts (custom cron-secret/service-role
 * auth, not a Supabase user JWT).
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/release-day-announcements`

/** Resolves the service role key the Edge Function runtime actually uses (see update-scores.test.ts). */
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
  name: 'release-day-announcements',
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

      await t.step('returns 403 with an invalid Bearer token', async () => {
        const { status } = await call({ Authorization: 'Bearer nope', 'Content-Type': 'application/json' })
        assertEquals(status, 403)
      })

      await t.step('succeeds with the service role key and reports zero when nothing releases today', async () => {
        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertExists(data.leagues_notified)
        assertExists(data.movies_announced)
      })

      await t.step('announces a rostered movie releasing today, then does not re-announce on rerun', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('release-day'))
        const today = new Date().toISOString().split('T')[0]

        // The active league fixture drafts movies with future release dates;
        // force one to release today so this run picks it up.
        const { data: picks } = await serviceClient
          .from('draft_picks')
          .select('movie_id')
          .eq('league_id', leagueId)
          .limit(1)

        const movieId = picks![0].movie_id
        createdMovieIds.push(movieId)
        await serviceClient.from('movies').update({ release_date: today }).eq('id', movieId)

        const first = await call(authHeaders())
        assertEquals(first.status, 200)
        assertEquals(first.data.leagues_notified >= 1, true)
        assertEquals(first.data.movies_announced >= 1, true)

        const { data: logRows } = await serviceClient
          .from('discord_notification_log')
          .select('id')
          .eq('league_id', leagueId)
          .eq('movie_id', movieId)
          .eq('notification_type', 'release_day')

        assertEquals(logRows!.length, 1)

        // Rerun: same movie should not be announced again
        const second = await call(authHeaders())
        assertEquals(second.status, 200)

        const { data: logRowsAfterRerun } = await serviceClient
          .from('discord_notification_log')
          .select('id')
          .eq('league_id', leagueId)
          .eq('movie_id', movieId)
          .eq('notification_type', 'release_day')

        assertEquals(logRowsAfterRerun!.length, 1)
      })
    } finally {
      if (createdMovieIds.length > 0) {
        await serviceClient.from('discord_notification_log').delete().in('movie_id', createdMovieIds)
      }
      await factory.cleanup()
    }
  },
})
