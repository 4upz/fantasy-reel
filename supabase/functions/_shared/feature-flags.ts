/**
 * Operator feature flags, backed by the `feature_flags` table.
 *
 * Operators edit rows in Supabase Studio -> Table Editor -> feature_flags
 * (toggle `enabled`, edit `config`). No deploy, no SQL. Reads are memoized
 * per isolate for 60s so a cron that consults a flag once per item does
 * not hammer the table; a missing row or a read error is `disabled`, which
 * is the safe default for every flag we have (they all gate spend or
 * visibility).
 */
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/feature-flags')

const CACHE_TTL_MS = 60_000

export interface FeatureFlag {
  enabled: boolean
  config: Record<string, unknown>
}

/** Structural client slice so this module needs no esm.sh type import. */
export interface FlagClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>
      }
    }
  }
}

/**
 * Adapts a real SupabaseClient to the structural FlagClient. The cast exists
 * because TypeScript hits TS2589 ("excessively deep") comparing supabase-js's
 * generic query builders against the narrow structural type; the runtime
 * shape is identical. Use this at every getFlag call site instead of casting.
 */
export function asFlagClient(client: { from: unknown }): FlagClient {
  return client as unknown as FlagClient
}

const DISABLED: FeatureFlag = { enabled: false, config: {} }

const cache = new Map<string, { flag: FeatureFlag; fetchedAt: number }>()

export function clearFlagCache(): void {
  cache.clear()
}

export async function getFlag(
  client: FlagClient,
  key: string,
  opts: { now?: () => number } = {}
): Promise<FeatureFlag> {
  const now = opts.now ?? Date.now
  const cached = cache.get(key)
  if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) return cached.flag

  const { data, error } = await client.from('feature_flags').select('key, enabled, config').eq('key', key).maybeSingle()
  if (error) {
    log.warn('Feature flag read failed; treating as disabled', { key, error: serializeError(error) })
    return DISABLED
  }
  const row = data as { enabled?: boolean; config?: unknown } | null
  const flag: FeatureFlag = row
    ? { enabled: row.enabled === true, config: isRecord(row.config) ? row.config : {} }
    : DISABLED
  cache.set(key, { flag, fetchedAt: now() })
  return flag
}

/** Reads a numeric config value, falling back when absent or not a finite number. */
export function flagNumber(flag: FeatureFlag, key: string, fallback: number): number {
  const value = flag.config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
