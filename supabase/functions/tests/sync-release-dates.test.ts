/**
 * Integration tests for sync-release-dates Edge Function
 *
 * Tests the actual function via direct fetch() with service role auth.
 *
 * Every success path of this function calls the live TMDb API -- once per
 * rostered movie released within the recent-cutoff window, with no upper bound
 * -- so those steps are gated behind RUN_EXTERNAL_API_TESTS. See
 * `RUN_EXTERNAL_API_TESTS` in ./_setup.ts for why, and `deno task test:external`
 * to run them. The drift-detection logic is covered against mocks in
 * ../_shared/sync-release-dates.test.ts.
 *
 * Requires: npx supabase start && npx supabase functions serve, plus
 * TMDB_API_KEY configured for the local functions runtime.
 */

import { assertEquals } from '@std/assert'
import {
  getServiceClient,
  getEdgeFunctionServiceRoleKey,
  createTestFactory,
  uniqueName,
  RUN_EXTERNAL_API_TESTS,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sync-release-dates`

Deno.test({
  name: 'sync-release-dates',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()

    async function call(headers: Record<string, string>) {
      const response = await fetch(FUNCTION_URL, { method: 'POST', headers })
      const data = await response.json()
      return { status: response.status, data }
    }

    function authHeaders(): Record<string, string> {
      return { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
    }

    await t.step('returns 403 with no auth headers', async () => {
      const { status, data } = await call({ 'Content-Type': 'application/json' })
      assertEquals(status, 403)
      assertEquals(data.error, 'Forbidden')
    })

    // Any authorized call fans out to TMDb across the whole rostered set, so
    // both remaining steps are opt-in.
    await t.step({
      name: 'succeeds with the service role key',
      ignore: !RUN_EXTERNAL_API_TESTS,
      fn: async () => {
        const { status, data } = await call(authHeaders())
        assertEquals(status, 200)
        assertEquals(typeof data.movies_checked, 'number')
        assertEquals(typeof data.dates_changed, 'number')
        assertEquals(typeof data.leagues_notified, 'number')
      },
    })

    await t.step({
      name: 'detects and corrects a stale release date for a rostered movie',
      ignore: !RUN_EXTERNAL_API_TESTS,
      fn: async () => {
        // TMDb ID 238 = The Godfather, real release date 1972-03-14. Chosen to
        // NOT collide with tests/update-scores.test.ts, which seeds 278.
        const REAL_TMDB_ID = 238
        const REAL_RELEASE_DATE = '1972-03-14'

        // Neutralize any leftover row holding this tmdb_id (e.g. from an
        // aborted earlier run) -- movies_tmdb_id_key is unique, and deleting
        // could hit FK references, so repoint instead.
        await serviceClient
          .from('movies')
          .update({ tmdb_id: 900_000_000 + Math.floor(Math.random() * 1_000_000) })
          .eq('tmdb_id', REAL_TMDB_ID)

        const { factory } = await createTestFactory()

        try {
          const leagueId = await factory.createActiveLeague(uniqueName('sync-release-dates'))

          const { data: picks } = await serviceClient
            .from('draft_picks')
            .select('movie_id, movies(tmdb_id)')
            .eq('league_id', leagueId)
            .limit(1)

          const movieId = picks![0].movie_id

          // Capture the row's original identity so cleanup can restore it --
          // pool movies are shared across tests, and leaving a past
          // release_date behind breaks later drafts.
          const { data: original } = await serviceClient
            .from('movies')
            .select('tmdb_id, release_date')
            .eq('id', movieId)
            .single()

          // Point this roster slot at the real, stable movie with a deliberately
          // wrong stored date -- kept within the "recent" cutoff window
          // (today) so the candidate query still picks it up.
          const wrongButRecentDate = new Date().toISOString().split('T')[0]
          await serviceClient
            .from('movies')
            .update({ tmdb_id: REAL_TMDB_ID, release_date: wrongButRecentDate })
            .eq('id', movieId)

          try {
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

            assertEquals(updatedMovie!.release_date, REAL_RELEASE_DATE)
          } finally {
            // factory.cleanup() does not delete movies rows -- restore the
            // original tmdb_id AND release_date so the shared pool movie is
            // usable by later tests, and the real tmdb_id is released.
            await serviceClient
              .from('movies')
              .update({
                tmdb_id: original?.tmdb_id ?? 900_000_000 + Math.floor(Math.random() * 1_000_000),
                release_date: original?.release_date ?? '2026-12-15',
              })
              .eq('id', movieId)
          }
        } finally {
          await factory.cleanup()
        }
      },
    })
  },
})
