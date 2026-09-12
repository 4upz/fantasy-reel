import { assert, assertEquals, assertRejects } from '@std/assert'
import { createClient } from '@supabase/supabase-js'
import { cleanupDraftMovieCache } from '../tests/_setup.ts'
import { buildCacheKey } from './tmdb-cache.ts'

function cleanupClient(respond: (call: number) => Response = () => new Response(null, { status: 204 })) {
  const calls: URL[] = []
  const client = createClient('http://127.0.0.1:1', 'unit-test-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const url = new URL(String(input))
        assert(init && 'method' in init)
        assertEquals(init.method, 'DELETE')
        assertEquals(url.pathname, '/rest/v1/tmdb_cache')
        assertEquals([...url.searchParams.keys()], ['cache_key'])
        assert(url.href.length < 4096, 'cache cleanup must keep each URL below 4 KiB')
        calls.push(url)
        return Promise.resolve(respond(calls.length))
      },
    },
  })
  return { client, calls }
}

function requestedKeys(calls: URL[]) {
  return calls.flatMap(url => {
    const filter = url.searchParams.get('cache_key')!
    assert(filter.startsWith('in.(') && filter.endsWith(')'), 'every delete must select exact cache keys')
    return filter.slice(4, -1).split(',')
  })
}

Deno.test('draft cache cleanup bounds actual SDK URLs and deletes every tracked key exactly once', async () => {
  const ids = Array.from({ length: 303 }, (_, index) => 1_900_000_000 + index)
  const { client, calls } = cleanupClient()
  await cleanupDraftMovieCache(client, ids)
  assert(calls.length > 1, 'large factories require multiple requests')
  assertEquals(requestedKeys(calls), ids.map(tmdb_id => buildCacheKey('movie_details', { tmdb_id })))
  const count = calls.length
  await cleanupDraftMovieCache(client, [])
  assertEquals(calls.length, count, 'an empty factory must not issue an unfiltered delete')
})

Deno.test('draft cache cleanup attempts later batches and retains every cleanup failure', async () => {
  const ids = Array.from({ length: 153 }, (_, index) => 1_900_000_000 + index)
  const { client, calls } = cleanupClient(call => call === 1 || call === 3
    ? Response.json({ message: `Rejected batch ${call}`, code: `TEST${call}`, details: 'inert fixture', hint: null }, { status: 503 })
    : new Response(null, { status: 204 }))
  const error = await assertRejects(() => cleanupDraftMovieCache(client, ids), AggregateError,
    'Failed to clean up draft movie cache')
  assertEquals(requestedKeys(calls), ids.map(tmdb_id => buildCacheKey('movie_details', { tmdb_id })))
  assertEquals(error.errors.map(failure => failure.message), ['Rejected batch 1', 'Rejected batch 3'])
  assertEquals(error.errors.map(failure => failure.cause.code), ['TEST1', 'TEST3'])
})
