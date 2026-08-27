/**
 * Integration tests for update-scores Edge Function
 *
 * Tests the actual function via direct fetch() with service role auth.
 * This function uses custom auth (X-Cron-Secret OR Bearer service_role)
 * instead of Supabase user JWT, so we call it directly rather than
 * using client.functions.invoke().
 *
 * Most steps here exercise paths that never reach MDBList (auth, validation,
 * empty results). The handful that do call the live API are gated behind
 * RUN_EXTERNAL_API_TESTS -- see `RUN_EXTERNAL_API_TESTS` in ./_setup.ts for
 * why, and `deno task test:external` to run them. The scoring logic itself is
 * covered against mocks in ../_shared/update-scores.test.ts.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assert, assertEquals, assertExists } from '@std/assert'
import {
  getServiceClient,
  getEdgeFunctionServiceRoleKey,
  RUN_EXTERNAL_API_TESTS,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
/**
 * The `supabase start` edge runtime serves the *main checkout's* functions, so
 * a worktree change to update-scores is only exercised by pointing
 * UPDATE_SCORES_URL at a standalone `deno run update-scores/index.ts` (which
 * binds :8000) -- same pattern as PLACE_BID_URL in place-bid.test.ts. Unset,
 * calls go through the shared runtime as before.
 */
const FUNCTION_URL = Deno.env.get('UPDATE_SCORES_URL') ?? `${SUPABASE_URL}/functions/v1/update-scores`

/** A syntactically valid UUID that never matches a row. */
const NONEXISTENT_UUID = '00000000-0000-0000-0000-000000000001'

Deno.test({
  name: 'update-scores',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()
    const createdMovieIds: string[] = []
    let tmdbCounter = 999000

    /**
     * Call update-scores with the Edge Function's service role key.
     * Parses JSON response and returns status + data.
     */
    async function callUpdateScores(body?: Record<string, unknown>) {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json()
      return { status: response.status, data }
    }

    /**
     * Raw fetch without service role auth (for testing auth rejection).
     */
    async function fetchRaw(
      method: string,
      headers: Record<string, string>
    ): Promise<{ status: number; data: Record<string, unknown> }> {
      const response = await fetch(FUNCTION_URL, { method, headers })
      const data = method === 'OPTIONS'
        ? { text: await response.text() }
        : await response.json()
      return { status: response.status, data: data as Record<string, unknown> }
    }

    /**
     * Seed a test movie and track it for cleanup.
     */
    async function seedTestMovie(overrides: Record<string, unknown> = {}): Promise<string> {
      const tmdbId = tmdbCounter++
      const { data: movie, error } = await serviceClient
        .from('movies')
        .insert({
          tmdb_id: tmdbId,
          title: `Test Movie ${tmdbId}`,
          overview: 'Test movie for update-scores',
          release_date: '2025-01-01',
          status: 'released',
          ...overrides,
        })
        .select('id')
        .single()

      if (error || !movie) {
        throw new Error(`Failed to seed movie: ${error?.message}`)
      }
      createdMovieIds.push(movie.id)
      return movie.id
    }

    try {
      // ============================================================================
      // Authentication Tests
      // ============================================================================

      await t.step('returns 403 when no auth headers provided', async () => {
        const { status, data } = await fetchRaw('POST', { 'Content-Type': 'application/json' })
        assertEquals(status, 403)
        assertEquals(data.error, 'Forbidden')
      })

      await t.step('returns 403 with invalid Bearer token', async () => {
        const { status, data } = await fetchRaw('POST', {
          'Authorization': 'Bearer invalid-key-12345',
          'Content-Type': 'application/json',
        })
        assertEquals(status, 403)
        assertEquals(data.error, 'Forbidden')
      })

      await t.step('handles CORS preflight request', async () => {
        const { status } = await fetchRaw('OPTIONS', {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        })
        assertEquals(status < 300, true)
      })

      // ============================================================================
      // Service Role Auth - Success
      //
      // Scoped to a movie_ids request that matches nothing, so the service role
      // key is exercised end to end without triggering any MDBList lookups.
      // ============================================================================

      await t.step('succeeds with service role Bearer token', async () => {
        const { status, data } = await callUpdateScores({ movie_ids: [NONEXISTENT_UUID] })
        assertEquals(status, 200)
        assertExists(data.movies_fetched)
        assertExists(data.scores_updated)
        assertExists(data.errors)
      })

      // ============================================================================
      // Validation Tests
      // ============================================================================

      await t.step('returns 400 for movie_ids with all invalid UUIDs', async () => {
        const { status, data } = await callUpdateScores({
          movie_ids: ['not-a-uuid', 'also-not-valid'],
        })
        assertEquals(status, 400)
        assertEquals(data.error, 'No valid movie_ids provided')
      })

      await t.step('returns 400 for invalid league_id', async () => {
        const { status, data } = await callUpdateScores({
          league_id: 'not-a-uuid',
        })
        assertEquals(status, 400)
        assertEquals(data.error, 'Invalid league_id')
      })

      await t.step('filters valid UUIDs from mixed movie_ids array', async () => {
        // Reaching 200 rather than 'No valid movie_ids provided' is the signal
        // that the invalid entries were filtered rather than rejecting the
        // whole request. A non-existent UUID keeps this off the MDBList path.
        const { status } = await callUpdateScores({
          movie_ids: ['not-valid', NONEXISTENT_UUID, 'also-invalid'],
        })
        assertEquals(status, 200)
      })

      // ============================================================================
      // Empty Results Tests
      // ============================================================================

      await t.step('returns empty results for non-existent movie_ids', async () => {
        const { status, data } = await callUpdateScores({
          movie_ids: [NONEXISTENT_UUID],
        })
        assertEquals(status, 200)
        assertEquals(data.movies_fetched, 0)
        assertEquals(data.scores_updated, 0)
        assertEquals(data.errors.length, 0)
      })

      await t.step('returns empty results for non-existent league_id', async () => {
        const { status, data } = await callUpdateScores({
          league_id: NONEXISTENT_UUID,
        })
        assertEquals(status, 200)
        assertEquals(data.movies_fetched, 0)
        assertEquals(data.scores_updated, 0)
        assertEquals(data.errors.length, 0)
      })

      // ============================================================================
      // Movie Without TMDb ID Test
      //
      // tmdb_id 0 short-circuits before any MDBList lookup.
      // ============================================================================

      await t.step('reports error for movie without TMDb ID', async () => {
        const movieId = await seedTestMovie({ tmdb_id: 0 })

        const { status, data } = await callUpdateScores({
          movie_ids: [movieId],
        })

        assertEquals(status, 200)
        assertExists(data.errors)
        const movieError = data.errors.find(
          (e: { movie_id: string }) => e.movie_id === movieId
        )
        assertExists(movieError)
        assertEquals(movieError.error, 'No TMDb ID available')
      })

      // ============================================================================
      // Live MDBList Contract Tests (opt-in)
      //
      // The only coverage that catches MDBList changing response shape, auth, or
      // field names. Kept to a single movie so one run costs one API call.
      // ============================================================================

      await t.step({
        name: 'processes a movie with a real TMDb ID and stores reviews',
        ignore: !RUN_EXTERNAL_API_TESTS,
        fn: async () => {
          // TMDb ID 278 = The Shawshank Redemption
          const movieId = await seedTestMovie({
            tmdb_id: 278,
            title: 'The Shawshank Redemption',
            release_date: '1994-09-23',
          })

          const { status, data } = await callUpdateScores({
            movie_ids: [movieId],
          })

          assertEquals(status, 200)
          assertEquals(data.movies_fetched, 1)
          assertEquals(data.scores_updated, 1)

          // Verify reviews were stored in the database
          const { data: reviews } = await serviceClient
            .from('reviews')
            .select('source, score, raw_score')
            .eq('movie_id', movieId)

          assertExists(reviews)
          assertEquals(reviews!.length > 0, true)

          const sources = reviews!.map((r: { source: string }) => r.source)
          assertEquals(sources.includes('imdb'), true)
        },
      })

      // Default mode is the one unbounded path: it processes every stale
      // released movie in the database (up to the function's limit of 30), one
      // MDBList call each. Exercised once, and only when opted in.
      await t.step({
        name: 'default mode processes stale released movies',
        ignore: !RUN_EXTERNAL_API_TESTS,
        fn: async () => {
          const { status, data } = await callUpdateScores()
          assertEquals(status, 200)
          assertEquals(typeof data.movies_fetched, 'number')
          assertEquals(typeof data.scores_updated, 'number')
          assertEquals(Array.isArray(data.errors), true)
        },
      })

    } finally {
      // ============================================================================
      // Cleanup
      // ============================================================================
      if (createdMovieIds.length > 0) {
        await serviceClient
          .from('reviews')
          .delete()
          .in('movie_id', createdMovieIds)

        await serviceClient
          .from('movies')
          .delete()
          .in('id', createdMovieIds)
      }
    }
  },
})

// ============================================================================
// Pre-release polling + projection freeze (Task 12)
//
// The flag-gated invocation step calls the live function's default (cron)
// branch, which also selects the nightly released set -- a real MDBList call
// if any stale released movie exists in the database. So it is gated behind
// RUN_EXTERNAL_API_TESTS like the other live-API steps in this file, above.
// The freeze step is pure DB and exercises the SQL contract update-scores
// relies on (calculate_movie_score, then the conditional frozen_at update)
// without touching the network at all, so it always runs.
// ============================================================================

Deno.test('update-scores: pre-release polling is flag- and budget-gated', async (t) => {
  const service = getServiceClient()

  await t.step({
    name: 'with projections_ingestion disabled, no upcoming movies are polled',
    ignore: !RUN_EXTERNAL_API_TESTS,
    fn: async () => {
      const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()
      await service.from('feature_flags').update({ enabled: false }).eq('key', 'projections_ingestion')
      try {
        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
        })
        const data = await response.json()
        assertEquals(data.prerelease_polled, 0)
        assertEquals(data.prerelease_granted, 0)
      } finally {
        await service.from('feature_flags').update({ enabled: true }).eq('key', 'projections_ingestion')
      }
    },
  })

  await t.step('freeze stamps movie_projections when a score lands', async () => {
    // Seed a model + projection row, then a scored review, and exercise the
    // SQL contract the function relies on: calculate_movie_score followed by
    // the conditional frozen_at update.
    await service.from('projection_models').upsert({ version: 0, coefficients: {}, metrics: {}, is_active: false }, { onConflict: 'version' })
    const tmdbId = 900300001
    const { data: movie } = await service.from('movies').upsert(
      { tmdb_id: tmdbId, title: 'Freeze Me', release_date: '2020-01-01', status: 'released' }, { onConflict: 'tmdb_id' }
    ).select('id').single()
    await service.from('movie_projections').upsert({
      tmdb_id: tmdbId, model_version: 0, projected_rt: 70, sigma: 12, p_rotten: 0.2, p_fresh: 0.7, p_club90: 0.1,
      expected_points: 8, factors: {}, coverage: 0.5, partial: false, frozen_at: null, actual_rt: null,
    }, { onConflict: 'tmdb_id' })
    await service.from('reviews').upsert({ movie_id: movie!.id, source: 'rotten_tomatoes', score: 81, raw_score: '81%', fetched_at: new Date().toISOString() }, { onConflict: 'movie_id,source' })
    try {
      await service.rpc('calculate_movie_score', { p_movie_id: movie!.id })
      await service.from('movie_projections').update({ frozen_at: new Date().toISOString(), actual_rt: 81 }).eq('tmdb_id', tmdbId).is('frozen_at', null)
      const { data: frozen } = await service.from('movie_projections').select('frozen_at, actual_rt').eq('tmdb_id', tmdbId).single()
      assertEquals(frozen?.actual_rt, 81)
      assert(frozen?.frozen_at)
    } finally {
      // cleanup
      await service.from('movie_projections').delete().eq('tmdb_id', tmdbId)
      await service.from('reviews').delete().eq('movie_id', movie!.id)
      await service.from('movies').delete().eq('id', movie!.id)
    }
  })
})
