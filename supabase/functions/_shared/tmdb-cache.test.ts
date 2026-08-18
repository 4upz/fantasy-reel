/**
 * Unit tests for the TMDb read-through cache.
 *
 * The behaviors worth pinning are the failure ones: a cache that is down, or
 * a TMDb that is down. Both must degrade rather than surface an error, and
 * the only path that may throw is "nothing cached and TMDb failed".
 */

import { assertEquals, assertRejects } from '@std/assert'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCacheKey, getCachedOrFetch, purgeStaleTmdbCache } from './tmdb-cache.ts'
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
 * `select().eq().maybeSingle()`, `upsert()`, and `delete().lt().select()`.
 */
function createMockClient(options: MockOptions = {}) {
  const rows = options.rows ?? []
  const upserts: CacheRow[] = []
  const deletedBefore: string[] = []

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
        delete: () => ({
          lt: (_col: string, cutoff: string) => {
            deletedBefore.push(cutoff)
            return {
              select: () =>
                Promise.resolve(
                  options.deleteError
                    ? { data: null, error: options.deleteError }
                    : { data: rows.map((r) => ({ cache_key: r.cache_key })), error: null }
                ),
            }
          },
        }),
      }
    },
  }

  return { client: client as unknown as SupabaseClient, upserts, deletedBefore }
}

function row(overrides: Partial<CacheRow> & { expires_at: string }): CacheRow {
  return {
    cache_key: 'k',
    payload: { cached: true },
    fetched_at: new Date().toISOString(),
    ...overrides,
  }
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString()
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString()

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

Deno.test('getCachedOrFetch - stale-while-error serves the expired payload when the fetcher throws', async () => {
  const { client } = createMockClient({ rows: [row({ expires_at: anHourAgo() })] })
  const { log, lines } = createTestLogger()

  const result = await getCachedOrFetch(client, 'k', 60, () => {
    throw new Error('TMDb API error: 429')
  }, log)

  assertEquals(result.cacheStatus, 'stale')
  assertEquals(result.payload, { cached: true })

  const staleLine = lines.at(-1)
  assertEquals(staleLine?.level, 'warn')
  assertEquals(staleLine?.fields.cache_status, 'stale')
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

Deno.test('purgeStaleTmdbCache - deletes by fetched_at cutoff and reports the count', async () => {
  const { client, deletedBefore } = createMockClient({
    rows: [row({ cache_key: 'a', expires_at: anHourAgo() }), row({ cache_key: 'b', expires_at: anHourAgo() })],
  })

  const deleted = await purgeStaleTmdbCache(client, 90)

  assertEquals(deleted, 2)
  assertEquals(deletedBefore.length, 1)
  const cutoffAgeDays = (Date.now() - new Date(deletedBefore[0]).getTime()) / 86_400_000
  // Comfortably inside TMDb's 6-month retention ceiling.
  assertEquals(Math.round(cutoffAgeDays), 90)
})

Deno.test('purgeStaleTmdbCache - returns null on failure instead of throwing', async () => {
  const { client } = createMockClient({ deleteError: { message: 'permission denied' } })
  assertEquals(await purgeStaleTmdbCache(client), null)
})
