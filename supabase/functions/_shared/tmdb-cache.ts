/**
 * Read-through cache for TMDb responses, backed by the `tmdb_cache` table.
 *
 * Used by the three read-only TMDb Edge Functions (get-movie-details,
 * browse-movies, search-movies). What is stored is the *transformed* response
 * body those functions return, so a hit is served byte-for-byte identically to
 * a miss.
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

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError, type Logger } from './logger.ts'

const CACHE_TABLE = 'tmdb_cache'
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type CacheStatus = 'hit' | 'miss' | 'stale'

export interface CachedResult<T> {
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
export type CacheTtl<T> = number | ((payload: T) => number)

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
 */
export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)

  return `${prefix}:${parts.join('&')}`
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

    if (error) {
      log.warn('tmdb cache read failed', { cache_key: cacheKey, error: serializeError(error) })
      return null
    }

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

    if (error) {
      log.warn('tmdb cache write failed', { cache_key: cacheKey, error: serializeError(error) })
    }
  } catch (error) {
    log.warn('tmdb cache write failed', { cache_key: cacheKey, error: serializeError(error) })
  }
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
    const payload = await fetcher()
    await writeCache(client, cacheKey, payload, resolveTtlSeconds(ttlSeconds, payload), log)
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

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    log.warn('tmdb cache disabled: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    cacheClient = null
    return null
  }

  try {
    cacheClient = createClient(url, key)
  } catch (error) {
    log.warn('tmdb cache disabled: client creation failed', { error: serializeError(error) })
    cacheClient = null
  }
  return cacheClient
}

/**
 * `getCachedOrFetch` with the service-role client resolved for you -- the form
 * the TMDb Edge Functions actually call. Falls straight through to `fetcher`
 * when no cache client can be built.
 */
export async function cachedTmdbFetch<T>(
  cacheKey: string,
  ttlSeconds: CacheTtl<T>,
  fetcher: () => Promise<T>,
  log: Logger
): Promise<CachedResult<T>> {
  const client = getCacheClient(log)
  if (!client) return { payload: await fetcher(), cacheStatus: 'miss' }
  return getCachedOrFetch(client, cacheKey, ttlSeconds, fetcher, log)
}

const purgeLog = createLogger('shared/tmdb-cache')

/**
 * Deletes cache rows fetched more than `retentionDays` ago, enforcing TMDb's
 * "do not retain beyond 6 months" term with a wide margin. Runs nightly from
 * sync-release-dates.
 *
 * Best-effort like purgeOldJobRuns: never throws, so a purge failure cannot
 * break the caller's job outcome. Returns the number of rows deleted, or null
 * if the delete failed (logged either way).
 */
export async function purgeStaleTmdbCache(
  client: SupabaseClient,
  retentionDays = 90
): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY).toISOString()

    const { data, error } = await client
      .from(CACHE_TABLE)
      .delete()
      .lt('fetched_at', cutoff)
      .select('cache_key')

    if (error) {
      purgeLog.error('Failed to purge stale tmdb cache', {
        retention_days: retentionDays,
        error: serializeError(error),
      })
      return null
    }

    purgeLog.info('Purged stale tmdb cache', {
      retention_days: retentionDays,
      rows_deleted: data?.length ?? 0,
    })
    return data?.length ?? null
  } catch (err) {
    purgeLog.error('Failed to purge stale tmdb cache', {
      retention_days: retentionDays,
      error: serializeError(err),
    })
    return null
  }
}
