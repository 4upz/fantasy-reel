/**
 * Integration tests for update-scores Edge Function
 *
 * Tests the actual function via direct fetch() with service role auth.
 * This function uses custom auth (X-Cron-Secret OR Bearer service_role)
 * instead of Supabase user JWT, so we call it directly rather than
 * using client.functions.invoke().
 *
 * The service role key used by the Edge Function runtime may differ from
 * the key in .env.test (keys rotate on each `supabase start`). We resolve
 * the correct key from the Docker container's environment at test startup.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { getServiceClient } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/update-scores`

/**
 * Get the service role key that the Edge Function runtime actually uses.
 *
 * The .env.test key may not match the Docker container's key if Supabase
 * has been restarted. We query the container directly to get the correct key.
 * Falls back to the .env.test key if Docker query fails.
 */
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
  // Fallback to .env.test value
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

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
      // Service Role Auth - Success (default mode with no body)
      // ============================================================================

      await t.step('succeeds with service role Bearer token', async () => {
        const { status, data } = await callUpdateScores()
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

      // ============================================================================
      // Empty Results Tests
      // ============================================================================

      await t.step('returns empty results for non-existent movie_ids', async () => {
        const { status, data } = await callUpdateScores({
          movie_ids: ['00000000-0000-0000-0000-000000000001'],
        })
        assertEquals(status, 200)
        assertEquals(data.movies_fetched, 0)
        assertEquals(data.scores_updated, 0)
        assertEquals(data.errors.length, 0)
      })

      await t.step('returns empty results for non-existent league_id', async () => {
        const { status, data } = await callUpdateScores({
          league_id: '00000000-0000-0000-0000-000000000001',
        })
        assertEquals(status, 200)
        assertEquals(data.movies_fetched, 0)
        assertEquals(data.scores_updated, 0)
        assertEquals(data.errors.length, 0)
      })

      // ============================================================================
      // Movie Without TMDb ID Test
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
      // Specific Movie Processing Tests (using real TMDb IDs for MDBList lookup)
      // ============================================================================

      await t.step('processes a movie with a real TMDb ID and stores reviews', async () => {
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
      })

      await t.step('filters valid UUIDs from mixed movie_ids array', async () => {
        // TMDb ID 238 = The Godfather
        const movieId = await seedTestMovie({
          tmdb_id: 238,
          title: 'The Godfather',
          release_date: '1972-03-24',
        })

        const { status, data } = await callUpdateScores({
          movie_ids: ['not-valid', movieId, 'also-invalid'],
        })

        assertEquals(status, 200)
        assertEquals(data.movies_fetched >= 1, true)
      })

      // ============================================================================
      // Default Mode Tests
      // ============================================================================

      await t.step('default mode processes stale released movies', async () => {
        const { status, data } = await callUpdateScores()
        assertEquals(status, 200)
        assertEquals(typeof data.movies_fetched, 'number')
        assertEquals(typeof data.scores_updated, 'number')
        assertEquals(Array.isArray(data.errors), true)
      })

      // ============================================================================
      // Empty Body / Edge Cases
      // ============================================================================

      await t.step('handles empty body gracefully', async () => {
        const { status, data } = await callUpdateScores()
        assertEquals(status, 200)
        assertExists(data.movies_fetched)
      })

      await t.step('handles empty movie_ids array as default mode', async () => {
        const { status, data } = await callUpdateScores({ movie_ids: [] })
        assertEquals(status, 200)
        assertExists(data.movies_fetched)
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
