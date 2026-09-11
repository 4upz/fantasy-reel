import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { DraftMovieMetadataError, resolveDraftMovieMetadata, toDraftMovieMetadata } from './draft-movie-metadata.ts'
import type { MovieDetailsResponse } from './movie-details.ts'
import { createLogger } from './logger.ts'
import { stubFetch } from './_mock-client.ts'

const today = new Date().toISOString().slice(0, 10)
const seasonYear = Number(today.slice(0, 4))
const log = createLogger('draft-movie-metadata-test')

function details(overrides: Partial<MovieDetailsResponse> = {}): MovieDetailsResponse {
  return {
    tmdb_id: 123, imdb_id: null, title: 'Canonical Movie', tagline: null,
    overview: 'Canonical description', release_date: today, runtime: null,
    status: 'Planned', poster_url: null, backdrop_url: null, vote_average: 0,
    vote_count: 0, genres: [], cast: [], director: null, ...overrides,
  }
}

Deno.test('draft metadata validates trusted identity and calendar dates before persistence', () => {
  const metadata = toDraftMovieMetadata(123, details(), seasonYear)
  assertEquals(metadata.title, 'Canonical Movie')
  assertEquals(metadata.release_date, today)
  assertEquals(metadata.status, 'upcoming')
  assertEquals('fantasy_points' in metadata, false)
  assertEquals('combined_score' in metadata, false)
  for (const invalid of [details({ tmdb_id: 456 }), details({ title: '' }), details({ release_date: '2099-02-30' }), details({ release_date: '2099-99-01' })]) {
    const error = assertThrows(() => toDraftMovieMetadata(123, invalid, seasonYear), DraftMovieMetadataError)
    assertEquals(error.status, 503)
  }
  for (const ineligible of [details({ release_date: null }), details({ release_date: '2000-01-01' }), details({ status: 'Canceled' })]) {
    const error = assertThrows(() => toDraftMovieMetadata(123, ineligible, seasonYear), DraftMovieMetadataError)
    assertEquals(error.status, 400)
  }
})

Deno.test({
  name: 'draft metadata maps actual TMDb failures and accepts cached metadata without a token',
  sanitizeResources: false, // The cached Supabase client owns an auth interval.
  sanitizeOps: false,
  fn: async (t) => {
  const env = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TMDB_API_KEY'] as const
  const previous = env.map(key => Deno.env.get(key))
  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:1')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-key')
  Deno.env.set('TMDB_API_KEY', 'unit-test-token')
  try {
    await t.step('unknown identity is a 404 and credentials/upstream failures are retryable', async () => {
      for (const status of [404, 401, 429]) {
        const { restore } = stubFetch(url => url.includes('api.themoviedb.org')
          ? new Response('{}', { status })
          : new Response('[]', { status: 200 }))
        try {
          const error = await assertRejects(() => resolveDraftMovieMetadata(status, seasonYear, log), DraftMovieMetadataError)
          assertEquals(error.status, status === 404 ? 404 : 503)
        } finally { restore() }
      }
    })

    await t.step('normalizes a successful upstream lookup into canonical metadata', async () => {
      const { calls, restore } = stubFetch(url => url.includes('api.themoviedb.org')
        ? new Response(JSON.stringify({
          id: 321, title: 'Verified Upstream Movie', release_date: today,
          overview: 'Upstream synopsis', status: 'Planned', poster_path: '/verified.jpg',
          backdrop_path: null, genres: [], credits: { cast: [], crew: [] },
        }), { status: 200 })
        : new Response('[]', { status: 200 }))
      try {
        const metadata = await resolveDraftMovieMetadata(321, seasonYear, log)
        assertEquals(metadata.title, 'Verified Upstream Movie')
        assertEquals(metadata.poster_url, 'https://image.tmdb.org/t/p/w500/verified.jpg')
        assertEquals(metadata.release_date, today)
        assertEquals(calls.filter(call => call.url.includes('api.themoviedb.org')).length, 1)
      } finally { restore() }
    })

    await t.step('does not cache a malformed upstream success and permits a corrected retry', async () => {
      let correctIdentity = false
      const { calls, restore } = stubFetch(url => url.includes('api.themoviedb.org')
        ? new Response(JSON.stringify({
          id: correctIdentity ? 654 : 999, title: 'Corrected Movie', release_date: today,
          status: 'Planned', genres: [], credits: { cast: [], crew: [] },
        }), { status: 200 })
        : new Response('[]', { status: 200 }))
      try {
        const error = await assertRejects(() => resolveDraftMovieMetadata(654, seasonYear, log), DraftMovieMetadataError)
        assertEquals(error.status, 503)
        assertEquals(calls.some(call => 'payload' in call.body), false)
        correctIdentity = true
        const metadata = await resolveDraftMovieMetadata(654, seasonYear, log)
        assertEquals(metadata.tmdb_id, 654)
        assertEquals(calls.some(call => 'payload' in call.body), true)
      } finally { restore() }
    })

    await t.step('fresh trusted cache works without configured upstream credentials', async () => {
      Deno.env.delete('TMDB_API_KEY')
      const { calls, restore } = stubFetch(() => new Response(JSON.stringify({
        payload: details(), fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 }))
      try {
        const metadata = await resolveDraftMovieMetadata(123, seasonYear, log)
        assertEquals(metadata.title, 'Canonical Movie')
        assertEquals(calls.some(call => call.url.includes('api.themoviedb.org')), false)
      } finally { restore() }
    })

    await t.step('missing credentials on a cache miss returns a retryable lookup error', async () => {
      const { calls, restore } = stubFetch(() => new Response('[]', { status: 200 }))
      try {
        const error = await assertRejects(() => resolveDraftMovieMetadata(999, seasonYear, log), DraftMovieMetadataError)
        assertEquals(error.status, 503)
        assertEquals(calls.some(call => call.url.includes('api.themoviedb.org')), false)
      } finally { restore() }
    })
  } finally {
    env.forEach((key, index) => previous[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[index]!))
  }
}})
