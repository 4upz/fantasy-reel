/**
 * Read-through cache for TMDb responses, backed by the `tmdb_cache` table.
 *
 * Used by the three read-only TMDb Edge Functions (get-movie-details,
 * browse-movies, search-movies). What is stored is the *transformed* response
 * body those functions return, so a hit is served structurally identical to a
 * miss: same fields, same values. (Not byte-identical -- the payload lives in
 * a jsonb column, and Postgres re-orders jsonb object keys. Anything that
 * would hash, ETag, or snapshot the raw bytes must not rely on key order.)
 *
 * Two properties matter more than the hit rate:
 *
 * 1. The cache can never break a request. Every read and write failure is
 *    logged and swallowed -- a broken cache degrades to calling TMDb directly.
 * 2. Stale-while-error. An expired row is kept, not deleted. When the refetch
 *    throws (TMDb 429/5xx/timeout), the expired payload is served with
 *    cache_status 'stale' instead of surfacing the failure to the user. Only
 *    when there is nothing cached at all does the error propagate.
 *
 * Retention: TMDb's terms forbid retaining their data beyond 6 months.
 * `purgeStaleTmdbCache` enforces a 90-day ceiling and runs nightly from
 * sync-release-dates.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError, type Logger } from './logger.ts'
import { purgeByAge } from './job-runs.ts'
import { createServiceClient } from './utils.ts'

const CACHE_TABLE = 'tmdb_cache'

type CacheStatus = 'hit' | 'miss' | 'stale'

interface CachedResult<T> {
  payload: T
  cacheStatus: CacheStatus
}

/**
 * TTL in seconds, or a function deriving it from the freshly fetched payload.
 *
 * The function form exists for get-movie-details: how long a movie's details
 * stay valid depends on whether it has already been released, which is only
 * known *after* the fetch. Computing the TTL from the payload avoids a
 * chicken-and-egg first request that would have to guess.
 */
type CacheTtl<T> = number | ((payload: T) => number)

function resolveTtlSeconds<T>(ttl: CacheTtl<T>, payload: T): number {
  return typeof ttl === 'function' ? ttl(payload) : ttl
}

/**
 * Serializes a request parameter set into a stable cache key.
 *
 * Keys are sorted so callers cannot produce two keys for one request by
 * listing params in a different order; arrays are joined (already-sorted by
 * the caller when order is not semantically meaningful); undefined/null
 * params are dropped so an explicit `undefined` and an omitted param collapse
 * to the same key, as they do at the TMDb call itself.
 *
 * Keys and values are URI-escaped so the `&`/`=`/`,` delimiters cannot be
 * forged from inside a value: without this, a search for the literal string
 * `dune&year=2026` would collide with a search for `dune` filtered to 2026
 * and each would serve the other's cached result set.
 */
export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => {
      const encoded = Array.isArray(value)
        ? value.map((item) => encodeURIComponent(String(item))).join(',')
        : encodeURIComponent(String(value))
      return `${encodeURIComponent(key)}=${encoded}`
    })

  return `${prefix}:${parts.join('&')}`
}

/**
 * `buildCacheKey` over a TMDb request URL's own query string, so the key is
 * derived from the exact params the request carries instead of a hand-kept
 * mirror of them that can drift.
 *
 * `overrides` replaces (or adds) params in the key only -- used for normalized
 * values such as a lowercased search query, where TMDb still receives the raw
 * one. The URL carries no secret: the API token travels in the Authorization
 * header, never in the query string.
 */
export function cacheKeyForUrl(
  prefix: string,
  url: URL | string,
  overrides: Record<string, string> = {}
): string {
  const params: Record<string, string> = {}
  for (const [key, value] of new URL(url).searchParams) {
    params[key] = value
  }
  return buildCacheKey(prefix, { ...params, ...overrides })
}

interface CacheRow {
  payload: unknown
  expires_at: string
}

/** Reads a row by key. Never throws -- a failed read is a miss. */
async function readCache(
  client: SupabaseClient,
  cacheKey: string,
  log: Logger
): Promise<CacheRow | null> {
  try {
    const { data, error } = await client
      .from(CACHE_TABLE)
      .select('payload, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle()

    if (error) throw error

    return (data as CacheRow | null) ?? null
  } catch (error) {
    log.warn('tmdb cache read failed', { cache_key: cacheKey, error: serializeError(error) })
    return null
  }
}

/** Upserts a freshly fetched payload. Never throws -- a failed write is just a lost cache entry. */
async function writeCache(
  client: SupabaseClient,
  cacheKey: string,
  payload: unknown,
  ttlSeconds: number,
  log: Logger
): Promise<void> {
  const now = new Date()
  try {
    const { error } = await client
      .from(CACHE_TABLE)
      .upsert({
        cache_key: cacheKey,
        payload,
        fetched_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      }, { onConflict: 'cache_key' })

    if (error) throw error
  } catch (error) {
    log.warn('tmdb cache write failed', { cache_key: cacheKey, error: serializeError(error) })
  }
}

/**
 * Runs `work` off the response path when the runtime supports it, mirroring
 * `internalErrorResponse` (_shared/utils.ts) and `dispatchAlert`
 * (_shared/job-runs.ts): `EdgeRuntime.waitUntil` lets the cache write finish
 * after the response is sent, and outside that runtime (tests, local Deno) it
 * is awaited inline, since an unawaited promise may never settle before the
 * isolate is torn down.
 */
function detach(work: Promise<void>): Promise<void> {
  const g = globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }
  if (g.EdgeRuntime?.waitUntil) {
    g.EdgeRuntime.waitUntil(work)
    return Promise.resolve()
  }
  return work
}

/**
 * Fetches in flight, by cache key.
 *
 * A cold popular key (the first draft-board browse of the day, a typeahead
 * prefix several drafters hit at once) would otherwise send one TMDb call per
 * concurrent request, all of them redundant. Sharing the promise makes the
 * first caller's fetch the only one; the rest await it and get the same
 * payload. Scoped to one isolate -- this is deduplication, not a second cache
 * tier.
 */
const inFlight = new Map<string, Promise<unknown>>()

function coalesce<T>(cacheKey: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(cacheKey) as Promise<T> | undefined
  if (existing) return existing

  const promise = work().finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, promise)
  return promise
}

/**
 * Serves `cacheKey` from `tmdb_cache`, calling `fetcher` when the entry is
 * missing or expired.
 *
 * `client` must be a service-role client -- the table has RLS on with no
 * policies. `fetcher` must throw on failure; a thrown error falls back to an
 * expired entry when one exists ('stale'), and is otherwise rethrown for the
 * caller's own error mapping (e.g. TMDb 429 -> HTTP 429).
 *
 * Concurrent misses on one key share a single `fetcher` call (see `coalesce`),
 * so a cold popular key costs one TMDb request, not one per request in flight.
 *
 * Emits exactly one structured line per call carrying cache_key and
 * cache_status, so hit rate per namespace is answerable from logs alone.
 */
export async function getCachedOrFetch<T>(
  client: SupabaseClient,
  cacheKey: string,
  ttlSeconds: CacheTtl<T>,
  fetcher: () => Promise<T>,
  log: Logger
): Promise<CachedResult<T>> {
  const cached = await readCache(client, cacheKey, log)

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    log.info('tmdb cache', { cache_key: cacheKey, cache_status: 'hit' })
    return { payload: cached.payload as T, cacheStatus: 'hit' }
  }

  try {
    const payload = await coalesce(cacheKey, async () => {
      const fetched = await fetcher()
      // The write is off the response path where the runtime allows it: the
      // user's answer is already in hand, and writeCache swallows its own
      // failures, so there is nothing left to wait for.
      await detach(writeCache(client, cacheKey, fetched, resolveTtlSeconds(ttlSeconds, fetched), log))
      return fetched
    })
    log.info('tmdb cache', { cache_key: cacheKey, cache_status: 'miss' })
    return { payload, cacheStatus: 'miss' }
  } catch (error) {
    if (cached) {
      // Stale-while-error: a rate-limited or down TMDb is far better answered
      // with yesterday's payload than with a 429 the user cannot act on.
      log.warn('tmdb cache', {
        cache_key: cacheKey,
        cache_status: 'stale',
        expired_at: cached.expires_at,
        error: serializeError(error),
      })
      return { payload: cached.payload as T, cacheStatus: 'stale' }
    }
    log.warn('tmdb cache', { cache_key: cacheKey, cache_status: 'miss', error: serializeError(error) })
    throw error
  }
}

/**
 * Lazily built service-role client shared by every cached TMDb call in one
 * isolate. `null` means the cache is unavailable (env not wired) -- callers
 * fall through to TMDb, they do not fail.
 */
let cacheClient: SupabaseClient | null | undefined

function getCacheClient(log: Logger): SupabaseClient | null {
  if (cacheClient !== undefined) return cacheClient

  try {
    // Throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, which
    // for the cache is a degraded mode, not a failure.
    cacheClient = createServiceClient()
  } catch (error) {
    log.warn('tmdb cache disabled: no service role client', { error: serializeError(error) })
    cacheClient = null
  }
  return cacheClient
}

/**
 * `getCachedOrFetch` with the service-role client resolved for you -- the form
 * the TMDb Edge Functions actually call. Falls straight through to `fetcher`
 * when no cache client can be built. Returns the payload alone: cache status
 * is logged here and no caller acts on it.
 */
export async function cachedTmdbFetch<T>(
  cacheKey: string,
  ttlSeconds: CacheTtl<T>,
  fetcher: () => Promise<T>,
  log: Logger
): Promise<T> {
  const client = getCacheClient(log)
  if (!client) return await fetcher()

  const { payload } = await getCachedOrFetch(client, cacheKey, ttlSeconds, fetcher, log)
  return payload
}

const purgeLog = createLogger('shared/tmdb-cache')

/**
 * Deletes cache rows fetched more than `retentionDays` ago, enforcing TMDb's
 * "do not retain beyond 6 months" term with a wide margin. Runs nightly from
 * sync-release-dates.
 *
 * Best-effort like purgeOldJobRuns, and the same primitive underneath: never
 * throws, so a purge failure cannot break the caller's job outcome. Returns
 * the number of rows deleted, or null if the delete failed.
 */
export function purgeStaleTmdbCache(
  client: SupabaseClient,
  retentionDays = 90
): Promise<number | null> {
  return purgeByAge(client, {
    table: CACHE_TABLE,
    column: 'fetched_at',
    retentionDays,
    log: purgeLog,
  })
}
