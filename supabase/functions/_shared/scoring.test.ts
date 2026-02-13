/**
 * Unit tests for shared scoring utilities
 * Pure unit tests that don't require integration infrastructure
 */

import { assertEquals } from '@std/assert'
import { normalizeRating, fetchImdbId } from './scoring.ts'

// ============================================================================
// normalizeRating Tests
// ============================================================================

Deno.test('normalizeRating', async (t) => {
  // --- IMDb ratings ---

  await t.step('parses IMDb rating "8.5/10" to score 85', () => {
    const result = normalizeRating({ Source: 'Internet Movie Database', Value: '8.5/10' })
    assertEquals(result, { source: 'imdb', score: 85, raw: '8.5/10' })
  })

  await t.step('parses IMDb "10.0/10" to score 100', () => {
    const result = normalizeRating({ Source: 'Internet Movie Database', Value: '10.0/10' })
    assertEquals(result, { source: 'imdb', score: 100, raw: '10.0/10' })
  })

  await t.step('parses IMDb "0.0/10" to score 0', () => {
    const result = normalizeRating({ Source: 'Internet Movie Database', Value: '0.0/10' })
    assertEquals(result, { source: 'imdb', score: 0, raw: '0.0/10' })
  })

  await t.step('rounds IMDb "8.45/10" to 85', () => {
    const result = normalizeRating({ Source: 'Internet Movie Database', Value: '8.45/10' })
    assertEquals(result, { source: 'imdb', score: 85, raw: '8.45/10' })
  })

  // --- Rotten Tomatoes ratings ---

  await t.step('parses Rotten Tomatoes "85%" to score 85', () => {
    const result = normalizeRating({ Source: 'Rotten Tomatoes', Value: '85%' })
    assertEquals(result, { source: 'rotten_tomatoes', score: 85, raw: '85%' })
  })

  await t.step('parses RT "100%" to score 100', () => {
    const result = normalizeRating({ Source: 'Rotten Tomatoes', Value: '100%' })
    assertEquals(result, { source: 'rotten_tomatoes', score: 100, raw: '100%' })
  })

  await t.step('parses RT "0%" to score 0', () => {
    const result = normalizeRating({ Source: 'Rotten Tomatoes', Value: '0%' })
    assertEquals(result, { source: 'rotten_tomatoes', score: 0, raw: '0%' })
  })

  // --- Metacritic ratings ---

  await t.step('parses Metacritic "78/100" to score 78', () => {
    const result = normalizeRating({ Source: 'Metacritic', Value: '78/100' })
    assertEquals(result, { source: 'metacritic', score: 78, raw: '78/100' })
  })

  await t.step('parses Metacritic "100/100" to score 100', () => {
    const result = normalizeRating({ Source: 'Metacritic', Value: '100/100' })
    assertEquals(result, { source: 'metacritic', score: 100, raw: '100/100' })
  })

  // --- Edge cases ---

  await t.step('returns null source for unknown rating source', () => {
    const result = normalizeRating({ Source: 'Unknown Source', Value: '5 stars' })
    assertEquals(result, { source: null, score: null, raw: '5 stars' })
  })

  await t.step('returns null score for N/A IMDb value', () => {
    const result = normalizeRating({ Source: 'Internet Movie Database', Value: 'N/A' })
    assertEquals(result, { source: 'imdb', score: null, raw: 'N/A' })
  })

  await t.step('returns null score for malformed IMDb value', () => {
    const result = normalizeRating({ Source: 'Internet Movie Database', Value: 'not-a-number' })
    assertEquals(result, { source: 'imdb', score: null, raw: 'not-a-number' })
  })

  await t.step('returns null score for N/A RT value', () => {
    const result = normalizeRating({ Source: 'Rotten Tomatoes', Value: 'N/A' })
    assertEquals(result, { source: 'rotten_tomatoes', score: null, raw: 'N/A' })
  })
})

// ============================================================================
// fetchImdbId Tests
// ============================================================================

Deno.test('fetchImdbId', async (t) => {
  const originalFetch = globalThis.fetch

  await t.step('returns IMDB ID when TMDb API succeeds', async () => {
    try {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ imdb_id: 'tt1234567' }), { status: 200 })
        )
      const result = await fetchImdbId(12345, 'test-key')
      assertEquals(result, 'tt1234567')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await t.step('returns null when TMDb returns no imdb_id', async () => {
    try {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ imdb_id: null }), { status: 200 })
        )
      const result = await fetchImdbId(12345, 'test-key')
      assertEquals(result, null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await t.step('returns null when TMDb API returns error', async () => {
    try {
      globalThis.fetch = () => Promise.resolve(new Response('', { status: 500 }))
      const result = await fetchImdbId(12345, 'test-key')
      assertEquals(result, null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await t.step('returns null on network error', async () => {
    try {
      globalThis.fetch = () => Promise.reject(new Error('Network error'))
      const result = await fetchImdbId(12345, 'test-key')
      assertEquals(result, null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
