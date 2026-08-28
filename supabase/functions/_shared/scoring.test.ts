/**
 * Unit tests for shared scoring utilities
 * Pure unit tests that don't require integration infrastructure
 */

import { assertEquals } from '@std/assert'
import { fetchMDBListRatings, fetchImdbId, MDBLIST_SOURCE_MAP } from './scoring.ts'
import { stubFetch } from './_mock-client.ts'

// --- Test helpers ---

const originalFetch = globalThis.fetch

/** Temporarily replace globalThis.fetch for the duration of `fn`, restoring it afterward. */
async function withMockFetch<T>(
  mockFetch: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  globalThis.fetch = mockFetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

/** Create a mock fetch that returns a JSON response with status 200. */
function jsonFetch(body: unknown): typeof globalThis.fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

/** Create a mock fetch that returns a plain-text response with the given status. */
function statusFetch(status: number, body = ''): typeof globalThis.fetch {
  return () => Promise.resolve(new Response(body, { status }))
}

// ============================================================================
// fetchMDBListRatings Tests
// ============================================================================

Deno.test('fetchMDBListRatings', async (t) => {
  // --- Happy path ---

  await t.step('returns all 3 professional sources when present', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Oppenheimer',
        ratings: [
          { source: 'imdb', value: 8.2, score: 82, votes: 1001680 },
          { source: 'metacritic', value: 90, score: 90, votes: 69 },
          { source: 'tomatoes', value: 93, score: 93, votes: 513 },
          { source: 'trakt', value: 80, score: 80, votes: 34016 },
          { source: 'tmdb', value: 80, score: 80, votes: 11332 },
        ],
      }),
      () => fetchMDBListRatings(872585, 'test-key'),
    )
    assertEquals(result.error, undefined)
    assertEquals(result.ratings.length, 3)
  })

  await t.step('maps "tomatoes" source to "rotten_tomatoes"', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'tomatoes', value: 85, score: 85, votes: 200 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings[0].source, 'rotten_tomatoes')
    assertEquals(result.ratings[0].score, 85)
    assertEquals(result.ratings[0].raw, '85%')
  })

  await t.step('formats raw scores correctly per source', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'imdb', value: 7.0, score: 70, votes: 500 },
          { source: 'tomatoes', value: 82, score: 82, votes: 300 },
          { source: 'metacritic', value: 60, score: 60, votes: 40 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings[0].raw, '7/10')
    assertEquals(result.ratings[1].raw, '82%')
    assertEquals(result.ratings[2].raw, '60/100')
  })

  // --- Filtering ---

  await t.step('filters out non-professional sources', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'trakt', value: 80, score: 80, votes: 34016 },
          { source: 'tmdb', value: 80, score: 80, votes: 11332 },
          { source: 'letterboxd', value: 4.2, score: 84, votes: 3923809 },
          { source: 'imdb', value: 8.0, score: 80, votes: 5000 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 1)
    assertEquals(result.ratings[0].source, 'imdb')
  })

  await t.step('skips ratings with null score', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'imdb', value: 8.0, score: null, votes: 0 },
          { source: 'tomatoes', value: 85, score: 85, votes: 100 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 1)
    assertEquals(result.ratings[0].source, 'rotten_tomatoes')
  })

  await t.step('skips ratings with zero votes', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'imdb', value: 8.0, score: 80, votes: 0 },
          { source: 'metacritic', value: 75, score: 75, votes: 50 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 1)
    assertEquals(result.ratings[0].source, 'metacritic')
  })

  await t.step('skips ratings with null votes', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'imdb', value: 8.0, score: 80, votes: null },
          { source: 'tomatoes', value: 90, score: 90, votes: 100 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 1)
    assertEquals(result.ratings[0].source, 'rotten_tomatoes')
  })

  await t.step('returns empty ratings when response has no ratings array', async () => {
    const result = await withMockFetch(
      jsonFetch({ title: 'Test' }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, undefined)
  })

  await t.step('returns empty ratings when all professional sources have null score', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'imdb', value: null, score: null, votes: null },
          { source: 'tomatoes', value: null, score: null, votes: null },
          { source: 'metacritic', value: null, score: null, votes: null },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
  })

  // --- Score boundaries ---

  await t.step('handles score boundary of 0', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'metacritic', value: 0, score: 0, votes: 10 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 1)
    assertEquals(result.ratings[0].score, 0)
    assertEquals(result.ratings[0].raw, '0/100')
  })

  await t.step('handles score boundary of 100', async () => {
    const result = await withMockFetch(
      jsonFetch({
        title: 'Test',
        ratings: [
          { source: 'tomatoes', value: 100, score: 100, votes: 50 },
        ],
      }),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 1)
    assertEquals(result.ratings[0].score, 100)
    assertEquals(result.ratings[0].raw, '100%')
  })

  // --- API errors ---

  await t.step('returns error on 401 (auth failure)', async () => {
    const result = await withMockFetch(
      statusFetch(401, 'Unauthorized'),
      () => fetchMDBListRatings(12345, 'bad-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'MDBList API authentication failed')
  })

  await t.step('returns error on 404 (not found)', async () => {
    const result = await withMockFetch(
      statusFetch(404, 'Not Found'),
      () => fetchMDBListRatings(999999, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'Movie not found on MDBList')
  })

  await t.step('returns error on 429 (rate limited)', async () => {
    const result = await withMockFetch(
      statusFetch(429, 'Rate limited'),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'MDBList API rate limit exceeded')
  })

  await t.step('returns error on 500 (server error)', async () => {
    const result = await withMockFetch(
      statusFetch(500, 'Server Error'),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'MDBList API error: 500')
  })

  await t.step('returns error on network failure', async () => {
    const result = await withMockFetch(
      () => Promise.reject(new Error('Network error')),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'Failed to fetch ratings from MDBList')
  })

  await t.step('returns error when API key is empty', async () => {
    const result = await fetchMDBListRatings(12345, '')
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'MDBList API key not configured')
  })

  await t.step('handles malformed JSON response', async () => {
    const result = await withMockFetch(
      statusFetch(200, 'not valid json {{{'),
      () => fetchMDBListRatings(12345, 'test-key'),
    )
    assertEquals(result.ratings.length, 0)
    assertEquals(result.error, 'Failed to fetch ratings from MDBList')
  })
})

Deno.test('fetchMDBListRatings details', async (t) => {
  await t.step('returns details alongside ratings', async () => {
    const { restore } = stubFetch((url) =>
      url.includes('api.mdblist.com')
        ? new Response(JSON.stringify({
            title: 'Dune', budget: 165000000, revenue: 410668500, certification: 'PG-13', released: '2021-09-15',
            production_companies: [{ id: 923, name: 'Legendary' }],
            ratings: [
              { source: 'tomatoes', value: 83, score: 83, votes: 500 },
              { source: 'imdb', value: 8.0, score: 80, votes: 900000 },
            ],
          }), { status: 200 })
        : undefined
    )
    try {
      const result = await fetchMDBListRatings(438631, 'key')
      assertEquals(result.error, undefined)
      assertEquals(result.details, {
        budget: 165000000, revenue: 410668500, certification: 'PG-13', released: '2021-09-15',
        company_ids: [923], rt_critic_votes: 500,
      })
      assertEquals(result.ratings.length, 2)
    } finally {
      restore()
    }
  })

  await t.step('exposes the HTTP status on failure', async () => {
    const { restore } = stubFetch((url) => (url.includes('api.mdblist.com') ? new Response('', { status: 404 }) : undefined))
    try {
      const result = await fetchMDBListRatings(1, 'key')
      assertEquals(result.status, 404)
      assertEquals(result.details, undefined)
    } finally {
      restore()
    }
  })
})

// ============================================================================
// MDBLIST_SOURCE_MAP Tests
// ============================================================================

Deno.test('MDBLIST_SOURCE_MAP', async (t) => {
  await t.step('maps imdb -> imdb', () => {
    assertEquals(MDBLIST_SOURCE_MAP['imdb'], 'imdb')
  })

  await t.step('maps tomatoes -> rotten_tomatoes', () => {
    assertEquals(MDBLIST_SOURCE_MAP['tomatoes'], 'rotten_tomatoes')
  })

  await t.step('maps metacritic -> metacritic', () => {
    assertEquals(MDBLIST_SOURCE_MAP['metacritic'], 'metacritic')
  })

  await t.step('returns undefined for unmapped source', () => {
    assertEquals(MDBLIST_SOURCE_MAP['letterboxd'], undefined)
  })
})

// ============================================================================
// fetchImdbId Tests
// ============================================================================

Deno.test('fetchImdbId', async (t) => {
  await t.step('returns IMDB ID when TMDb API succeeds', async () => {
    const result = await withMockFetch(
      jsonFetch({ imdb_id: 'tt1234567' }),
      () => fetchImdbId(12345, 'test-key'),
    )
    assertEquals(result, 'tt1234567')
  })

  await t.step('returns null when TMDb returns no imdb_id', async () => {
    const result = await withMockFetch(
      jsonFetch({ imdb_id: null }),
      () => fetchImdbId(12345, 'test-key'),
    )
    assertEquals(result, null)
  })

  await t.step('returns null when TMDb API returns error', async () => {
    const result = await withMockFetch(
      statusFetch(500),
      () => fetchImdbId(12345, 'test-key'),
    )
    assertEquals(result, null)
  })

  await t.step('returns null on network error', async () => {
    const result = await withMockFetch(
      () => Promise.reject(new Error('Network error')),
      () => fetchImdbId(12345, 'test-key'),
    )
    assertEquals(result, null)
  })
})
