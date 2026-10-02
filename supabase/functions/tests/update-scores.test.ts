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

import { assertEquals, assertExists } from '@std/assert'
import {
  createTestFactory,
  getServiceClient,
  getEdgeFunctionServiceRoleKey,
  RUN_EXTERNAL_API_TESTS,
  uniqueName,
} from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/update-scores`

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

/**
 * A movie can be scored before it releases, but its points only count toward
 * team totals from its release date. Scores are set directly here, and the
 * negative TMDb ids keep every step off MDBList: with no API key configured
 * the lookup fails fast, which these steps do not care about.
 */
Deno.test({
  name: 'update-scores pre-release scores',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()
    const movieIds: string[] = []

    const today = new Date().toISOString().slice(0, 10)
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const tmdbBase = -(2_000_000 + Math.floor(Math.random() * 1_000_000) * 2)

    async function callUpdateScores(body: Record<string, unknown>) {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: response.status, data: await response.json() }
    }

    /** A movie already carrying a score, drafted by the first user's team. */
    async function draftScoredMovie(
      leagueId: string,
      tmdbId: number,
      title: string,
      releaseDate: string,
      scored: Record<string, unknown>
    ): Promise<string> {
      const { data, error } = await serviceClient
        .from('movies')
        .insert({ tmdb_id: tmdbId, title, release_date: releaseDate, status: 'upcoming', ...scored })
        .select('id')
        .single()
      if (error || !data) throw new Error(`Failed to seed movie: ${error?.message}`)
      movieIds.push(data.id)
      await factory.createDraftPickForUser(leagueId, client, { tmdb_id: tmdbId, title, release_date: releaseDate })
      return data.id
    }

    async function teamTotal(teamId: string): Promise<number> {
      const { data } = await serviceClient.from('team_scores').select('total_points').eq('team_id', teamId).single()
      return Number(data?.total_points)
    }

    async function announced(movieId: string) {
      const { data } = await serviceClient
        .from('movies')
        .select('announced_fantasy_points, announced_before_release')
        .eq('id', movieId)
        .single()
      return data
    }

    try {
      const { id: leagueId } = await factory.createLeague(uniqueName('prerelease-scores'))
      await factory.addSecondParticipant(leagueId)
      const { error: leagueError } = await serviceClient.from('leagues').update({ status: 'active' }).eq('id', leagueId)
      assertEquals(leagueError, null)
      const team = await factory.getTeamForUser(leagueId, client)
      assertExists(team)

      // Posted before release at 90%, and out today
      const releasedId = await draftScoredMovie(leagueId, tmdbBase, 'Out Today', today, {
        fantasy_points: 30,
        combined_score: 90,
        announced_fantasy_points: 30,
        announced_rt_score: 90,
        announced_before_release: true,
      })
      // Reviews are in, but it opens next week
      const earlyId = await draftScoredMovie(leagueId, tmdbBase - 1, 'Out Next Week', nextWeek, {
        fantasy_points: 24,
        combined_score: 84,
      })
      // The total as it stood yesterday, before either counted
      const { error: scoreError } = await serviceClient
        .from('team_scores')
        .upsert({ team_id: team.teamId, total_points: 0 }, { onConflict: 'team_id' })
      assertEquals(scoreError, null)

      await t.step('a movie posted before release starts counting on release day', async () => {
        const { status, data } = await callUpdateScores({ movie_ids: [releasedId, earlyId] })

        assertEquals(status, 200)
        assertEquals(data.releases_counted, 1)
        assertEquals(await teamTotal(team.teamId), 30, 'only the released movie counts')
        assertEquals((await announced(releasedId))?.announced_before_release, false)
      })

      await t.step('a pre-release score is posted, and its release is still owed a post', async () => {
        const row = await announced(earlyId)
        assertEquals(Number(row?.announced_fantasy_points), 24)
        assertEquals(row?.announced_before_release, true)
      })

      await t.step('its own release day counts it, once', async () => {
        const { error } = await serviceClient.from('movies').update({ release_date: today }).eq('id', earlyId)
        assertEquals(error, null)

        const { data } = await callUpdateScores({ movie_ids: [earlyId] })
        assertEquals(data.releases_counted, 1)
        assertEquals(await teamTotal(team.teamId), 54)
        assertEquals((await announced(earlyId))?.announced_before_release, false)

        const { data: rerun } = await callUpdateScores({ movie_ids: [earlyId] })
        assertEquals(rerun.releases_counted, 0)
      })
    } finally {
      try {
        await factory.cleanup()
      } finally {
        const { error } = await serviceClient.from('movies').delete().in('id', movieIds)
        assertEquals(error, null)
      }
    }
  },
})
