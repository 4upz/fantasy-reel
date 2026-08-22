/**
 * Unit tests for the TMDb read-through cache.
 *
 * The behaviors worth pinning are the failure ones: a cache that is down, or
 * a TMDb that is down. Both must degrade rather than surface an error, and
 * the only path that may throw is "nothing cached and TMDb failed".
 */

import { assertEquals, assertRejects } from '@std/assert'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCacheKey, cacheKeyForUrl, getCachedOrFetch, purgeStaleTmdbCache } from './tmdb-cache.ts'
import type { Logger } from './logger.ts'

interface CacheRow {
  cache_key: string
  payload: unknown
  fetched_at: string
  expires_at: string
}

interface LoggedLine {
  level: 'info' | 'warn' | 'error'
  msg: string
  fields: Record<string, unknown>
}

function createTestLogger(): { log: Logger; lines: LoggedLine[] } {
  const lines: LoggedLine[] = []
  const record = (level: LoggedLine['level']) =>
    (msg: string, fields?: Record<string, unknown>) => {
      lines.push({ level, msg, fields: fields ?? {} })
    }
  return { log: { info: record('info'), warn: record('warn'), error: record('error') }, lines }
}

interface MockOptions {
  rows?: CacheRow[]
  readError?: { message: string }
  writeError?: { message: string }
  deleteError?: { message: string }
}

/**
 * Minimal stand-in for the exact query shapes tmdb-cache.ts issues:
 * `select().eq().maybeSingle()`, `upsert()`, and
 * `delete({ count: 'exact' }).lt()` -- the purge asks Postgres for the count
 * rather than shipping the deleted keys back.
 */
function createMockClient(options: MockOptions = {}) {
  const rows = options.rows ?? []
  const upserts: CacheRow[] = []
  const deletedBefore: string[] = []
  const countRequested: Array<'exact' | undefined> = []

  const client = {
    from(_table: string) {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, value: string) => ({
            maybeSingle: () =>
              Promise.resolve(
                options.readError
                  ? { data: null, error: options.readError }
                  : { data: rows.find((r) => r.cache_key === value) ?? null, error: null }
              ),
          }),
        }),
        upsert: (row: CacheRow) => {
          upserts.push(row)
          return Promise.resolve({ data: null, error: options.writeError ?? null })
        },
        delete: (opts?: { count: 'exact' }) => ({
          lt: (_col: string, cutoff: string) => {
            deletedBefore.push(cutoff)
            countRequested.push(opts?.count)
            return Promise.resolve(
              options.deleteError
                ? { count: null, error: options.deleteError }
                : { count: rows.length, error: null }
            )
          },
        }),
      }
    },
  }

  return { client: client as unknown as SupabaseClient, upserts, deletedBefore, countRequested }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function row(overrides: Partial<CacheRow> & { expires_at: string }): CacheRow {
  return {
    cache_key: 'k',
    payload: { cached: true },
    // An hour of freshness ending at expires_at unless the test says
    // otherwise: a row's own TTL sizes its stale grace window, so fetched_at
    // and expires_at have to stay coherent with each other.
    fetched_at: new Date(new Date(overrides.expires_at).getTime() - HOUR).toISOString(),
    ...overrides,
  }
}

/**
 * A row that was fresh for `ttlMs` and expired `expiredForMs` ago -- the exact
 * pair the stale grace window is derived from.
 */
function expiredRow(ttlMs: number, expiredForMs: number): CacheRow {
  const expiresAt = Date.now() - expiredForMs
  return row({
    fetched_at: new Date(expiresAt - ttlMs).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  })
}

const inAnHour = () => new Date(Date.now() + HOUR).toISOString()
const anHourAgo = () => new Date(Date.now() - HOUR).toISOString()

Deno.test('getCachedOrFetch - fresh row is a hit and never calls the fetcher', async () => {
  const { client } = createMockClient({ rows: [row({ expires_at: inAnHour() })] })
  const { log, lines } = createTestLogger()
  let fetcherCalls = 0

  const result = await getCachedOrFetch(client, 'k', 60, () => {
    fetcherCalls++
    return Promise.resolve({ cached: false })
  }, log)

  assertEquals(result.cacheStatus, 'hit')
  assertEquals(result.payload, { cached: true })
  assertEquals(fetcherCalls, 0)
  assertEquals(lines[0].fields.cache_status, 'hit')
  assertEquals(lines[0].fields.cache_key, 'k')
})

Deno.test('getCachedOrFetch - no row fetches, stores, and reports a miss', async () => {
  const { client, upserts } = createMockClient()
  const { log, lines } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 600, () => Promise.resolve({ fresh: true }), log)

  assertEquals(result.cacheStatus, 'miss')
  assertEquals(result.payload, { fresh: true })
  assertEquals(upserts.length, 1)
  assertEquals(upserts[0].cache_key, 'k')
  assertEquals(upserts[0].payload, { fresh: true })

  const ttlMs = new Date(upserts[0].expires_at).getTime() - new Date(upserts[0].fetched_at).getTime()
  assertEquals(ttlMs, 600_000)
  assertEquals(lines.at(-1)?.fields.cache_status, 'miss')
})

Deno.test('getCachedOrFetch - expired row is refetched, not served', async () => {
  const { client, upserts } = createMockClient({ rows: [row({ expires_at: anHourAgo() })] })
  const { log } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 60, () => Promise.resolve({ cached: false }), log)

  assertEquals(result.cacheStatus, 'miss')
  assertEquals(result.payload, { cached: false })
  assertEquals(upserts.length, 1)
})

Deno.test('getCachedOrFetch - a function TTL is derived from the fetched payload', async () => {
  const { client, upserts } = createMockClient()
  const { log } = createTestLogger()

  await getCachedOrFetch<{ released: boolean }>(
    client,
    'k',
    (payload) => (payload.released ? 3600 : 60),
    () => Promise.resolve({ released: true }),
    log
  )

  const ttlMs = new Date(upserts[0].expires_at).getTime() - new Date(upserts[0].fetched_at).getTime()
  assertEquals(ttlMs, 3_600_000)
})

Deno.test('getCachedOrFetch - stale-while-error serves an expired payload inside the grace window', async () => {
  // Fresh for an hour, expired five minutes ago: well inside its one-hour grace.
  const { client } = createMockClient({ rows: [expiredRow(HOUR, 5 * MINUTE)] })
  const { log, lines } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 60, () => {
    throw new Error('TMDb API error: 429')
  }, log)

  assertEquals(result.cacheStatus, 'stale')
  assertEquals(result.payload, { cached: true })

  const staleLine = lines.at(-1)
  assertEquals(staleLine?.level, 'warn')
  assertEquals(staleLine?.fields.cache_status, 'stale')
  assertEquals(staleLine?.fields.expired_for_seconds, 300)
  assertEquals(staleLine?.fields.stale_grace_seconds, 3600)
})

Deno.test('getCachedOrFetch - a row past its grace window is a miss, not a stale serve', async () => {
  // Fresh for an hour, expired ninety minutes ago: a row may be served stale
  // for at most as long as it was fresh, so this one is out of cover.
  const { client } = createMockClient({ rows: [expiredRow(HOUR, 90 * MINUTE)] })
  const { log, lines } = createTestLogger()

  await assertRejects(
    () => getCachedOrFetch(client, 'k', 60, () => Promise.reject(new Error('TMDb API error: 401')), log),
    Error,
    'TMDb API error: 401'
  )

  const line = lines.at(-1)
  assertEquals(line?.level, 'error')
  assertEquals(line?.fields.cache_status, 'miss')
  assertEquals(line?.fields.stale_beyond_grace, true)
  assertEquals(line?.fields.expired_for_seconds, 5400)
})

Deno.test('getCachedOrFetch - the grace window is capped at 24h however long the TTL was', async () => {
  const sevenDays = 7 * DAY
  const { log } = createTestLogger()

  // A movie-details row holds for a week, but grace tops out at a day.
  const justInside = createMockClient({ rows: [expiredRow(sevenDays, 23 * HOUR)] })
  const served = await getCachedOrFetch(justInside.client, 'k', 60, () => {
    throw new Error('TMDb API error: 503')
  }, log)
  assertEquals(served.cacheStatus, 'stale')

  const pastCap = createMockClient({ rows: [expiredRow(sevenDays, 25 * HOUR)] })
  await assertRejects(
    () => getCachedOrFetch(pastCap.client, 'k', 60, () => Promise.reject(new Error('TMDb API error: 503')), log),
    Error,
    'TMDb API error: 503'
  )
})

Deno.test('getCachedOrFetch - a stale serve past an hour logs at error level', async () => {
  // Still inside its 24h grace, so the payload is served -- but an hour of
  // failed refetches is the sustained-outage signal ops alerts on.
  const { client } = createMockClient({ rows: [expiredRow(DAY, 2 * HOUR)] })
  const { log, lines } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 60, () => {
    throw new Error('TMDb API error: 500')
  }, log)

  assertEquals(result.cacheStatus, 'stale')
  const line = lines.at(-1)
  assertEquals(line?.level, 'error')
  assertEquals(line?.fields.cache_status, 'stale')
  assertEquals(line?.fields.expired_for_seconds, 7200)
})

Deno.test('getCachedOrFetch - rethrows when the fetcher fails with nothing cached', async () => {
  const { client } = createMockClient()
  const { log } = createTestLogger()

  await assertRejects(
    () => getCachedOrFetch(client, 'k', 60, () => Promise.reject(new Error('TMDb API error: 429')), log),
    Error,
    'TMDb API error: 429'
  )
})

Deno.test('getCachedOrFetch - a failed cache read falls through to the fetcher', async () => {
  const { client, upserts } = createMockClient({
    rows: [row({ expires_at: inAnHour() })],
    readError: { message: 'relation "tmdb_cache" does not exist' },
  })
  const { log, lines } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 60, () => Promise.resolve({ fresh: true }), log)

  // The read error must not surface, and the fresh row must not be served
  // from a read that failed.
  assertEquals(result.cacheStatus, 'miss')
  assertEquals(result.payload, { fresh: true })
  assertEquals(upserts.length, 1)
  assertEquals(lines[0].level, 'warn')
  assertEquals(lines[0].msg, 'tmdb cache read failed')
})

Deno.test('getCachedOrFetch - a failed cache write still returns the fetched payload', async () => {
  const { client } = createMockClient({ writeError: { message: 'permission denied' } })
  const { log, lines } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 60, () => Promise.resolve({ fresh: true }), log)

  assertEquals(result.cacheStatus, 'miss')
  assertEquals(result.payload, { fresh: true })
  assertEquals(lines.some((l) => l.msg === 'tmdb cache write failed'), true)
})

Deno.test('getCachedOrFetch - a throwing cache client never breaks the request', async () => {
  const exploding = {
    from() {
      throw new Error('client is gone')
    },
  } as unknown as SupabaseClient
  const { log } = createTestLogger()

  const result = await getCachedOrFetch(exploding, 'k', 60, () => Promise.resolve({ fresh: true }), log)

  assertEquals(result.cacheStatus, 'miss')
  assertEquals(result.payload, { fresh: true })
})

Deno.test('getCachedOrFetch - concurrent callers of one cold key share a single fetch', async () => {
  const { client, upserts } = createMockClient()
  const { log } = createTestLogger()
  let fetcherCalls = 0

  const fetcher = () => {
    fetcherCalls++
    // Resolves a turn later so both callers are genuinely in flight at once.
    return new Promise<{ fresh: number }>((resolve) =>
      setTimeout(() => resolve({ fresh: fetcherCalls }), 5)
    )
  }

  const [first, second] = await Promise.all([
    getCachedOrFetch(client, 'hot', 60, fetcher, log),
    getCachedOrFetch(client, 'hot', 60, fetcher, log),
  ])

  // One TMDb call, one cache write, same payload handed to both callers.
  assertEquals(fetcherCalls, 1)
  assertEquals(upserts.length, 1)
  assertEquals(first.payload, { fresh: 1 })
  assertEquals(second.payload, { fresh: 1 })
})

Deno.test('getCachedOrFetch - a coalesced fetch is not held past its failure', async () => {
  const { client } = createMockClient()
  const { log } = createTestLogger()
  let fetcherCalls = 0

  const failing = () => {
    fetcherCalls++
    return Promise.reject(new Error('TMDb API error: 500'))
  }

  await assertRejects(() => getCachedOrFetch(client, 'cold', 60, failing, log))
  // The in-flight entry is cleared in `finally`, so the next request retries
  // rather than inheriting the failed promise forever.
  await assertRejects(() => getCachedOrFetch(client, 'cold', 60, failing, log))
  assertEquals(fetcherCalls, 2)
})

Deno.test('buildCacheKey - key order does not depend on param order', () => {
  assertEquals(
    buildCacheKey('browse', { page: 2, sort_by: 'popularity', gte: '2026-08-18' }),
    buildCacheKey('browse', { gte: '2026-08-18', page: 2, sort_by: 'popularity' })
  )
  assertEquals(
    buildCacheKey('browse', { page: 2, sort_by: 'popularity', gte: '2026-08-18' }),
    'browse:gte=2026-08-18&page=2&sort_by=popularity'
  )
})

Deno.test('buildCacheKey - arrays join and absent params collapse', () => {
  assertEquals(buildCacheKey('browse', { genres: [28, 35] }), 'browse:genres=28,35')
  assertEquals(buildCacheKey('search', { q: 'dune', year: undefined }), 'search:q=dune')
  assertEquals(buildCacheKey('search', { q: 'dune' }), buildCacheKey('search', { q: 'dune', year: undefined }))
})

Deno.test('buildCacheKey - delimiters inside a value cannot forge another key', () => {
  // A query literally containing "&year=2026" must not collide with a query
  // of "dune" plus an actual year param -- that collision would serve one
  // user's cached result set for the other's request.
  const forged = buildCacheKey('search', { query: 'dune&year=2026' })
  const filtered = buildCacheKey('search', { query: 'dune', year: 2026 })
  assertEquals(forged === filtered, false)

  // Same for "=" splitting a key, and for "," inside an array element.
  assertEquals(
    buildCacheKey('browse', { 'a=b': 'c' }) === buildCacheKey('browse', { a: 'b=c' }),
    false
  )
  assertEquals(
    buildCacheKey('browse', { genres: ['28,35'] }) === buildCacheKey('browse', { genres: [28, 35] }),
    false
  )
})

Deno.test('cacheKeyForUrl - derives the key from the request URL, sorted', () => {
  const url = new URL('https://api.themoviedb.org/3/search/movie?query=Dune&page=2&include_adult=false')

  assertEquals(cacheKeyForUrl('search', url), 'search:include_adult=false&page=2&query=Dune')
  // Same params, different order in the URL -- same key.
  assertEquals(
    cacheKeyForUrl('search', 'https://api.themoviedb.org/3/search/movie?page=2&include_adult=false&query=Dune'),
    cacheKeyForUrl('search', url)
  )
})

Deno.test('cacheKeyForUrl - overrides normalize a param in the key only', () => {
  const url = new URL('https://api.themoviedb.org/3/search/movie?query=%20DUNE%20&page=1')

  assertEquals(cacheKeyForUrl('search', url, { query: 'dune' }), 'search:page=1&query=dune')
  // The URL itself is untouched: TMDb still receives the raw query.
  assertEquals(url.searchParams.get('query'), ' DUNE ')
})

Deno.test('purgeStaleTmdbCache - deletes by fetched_at cutoff and reports the count', async () => {
  const { client, deletedBefore, countRequested } = createMockClient({
    rows: [row({ cache_key: 'a', expires_at: anHourAgo() }), row({ cache_key: 'b', expires_at: anHourAgo() })],
  })

  const deleted = await purgeStaleTmdbCache(client, 90)

  assertEquals(deleted, 2)
  // Counted server-side: a purge can span six figures of keys, none of which
  // anyone wants shipped back over the wire.
  assertEquals(countRequested, ['exact'])
  assertEquals(deletedBefore.length, 1)
  const cutoffAgeDays = (Date.now() - new Date(deletedBefore[0]).getTime()) / 86_400_000
  // Comfortably inside TMDb's 6-month retention ceiling.
  assertEquals(Math.round(cutoffAgeDays), 90)
})

Deno.test('purgeStaleTmdbCache - returns null on failure instead of throwing', async () => {
  const { client } = createMockClient({ deleteError: { message: 'permission denied' } })
  assertEquals(await purgeStaleTmdbCache(client), null)
})
