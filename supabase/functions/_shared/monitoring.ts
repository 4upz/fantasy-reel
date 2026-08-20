/**
 * Sentry telemetry for Edge Functions, lazily loaded so the happy path
 * (SENTRY_DSN unset) never pays for the import.
 *
 * Two exports:
 * - `captureException` -- error events, flushed inline before returning.
 * - `recordCacheOutcome` -- one counter metric per TMDb cache decision
 *   (`tmdb_cache.requests`, attributes `cache_status` + `cache_namespace`,
 *   both bounded enums), plus a single grouped error event when stale
 *   serving crosses the ops threshold. Fire-and-forget: it never throws and
 *   never blocks the response path; flushing rides `EdgeRuntime.waitUntil`.
 */

let initialized = false
// deno-lint-ignore no-explicit-any
let sentryPromise: Promise<any> | undefined

// Clamps to [0, 1], falling back to 0 when unset or unparseable.
function parseSampleRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (raw === undefined || Number.isNaN(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

// deno-lint-ignore no-explicit-any
async function getSentry(dsn: string): Promise<any> {
  if (!sentryPromise) {
    sentryPromise = import('npm:@sentry/deno@^10.42.0')
  }
  const Sentry = await sentryPromise
  if (!initialized) {
    const tracesSampleRate = parseSampleRate(Deno.env.get('SENTRY_TRACES_SAMPLE_RATE'), 0)
    Sentry.init({ dsn, tracesSampleRate })
    initialized = true
  }
  return Sentry
}

export async function captureException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  const dsn = Deno.env.get('SENTRY_DSN')
  if (!dsn) return

  try {
    const Sentry = await getSentry(dsn)
    Sentry.captureException(err, { extra: context })
    // The edge runtime may tear the isolate down right after the response is
    // sent, so the event must be flushed before returning rather than left
    // to a background timer.
    await Sentry.flush(2000)
  } catch (monitoringError) {
    console.warn(JSON.stringify({
      level: 'warn',
      fn: 'monitoring',
      msg: 'captureException failed',
      error: monitoringError instanceof Error ? monitoringError.message : String(monitoringError),
    }))
  }
}

/**
 * One stable message so every threshold crossing groups into a single Sentry
 * issue -- that issue's event frequency is what an alert rule watches. The
 * varying details travel as tags/extra, not in the message.
 */
const STALE_ALERT_MESSAGE = 'TMDb cache stale-serving threshold exceeded'

export interface CacheOutcome {
  cacheKey: string
  status: 'hit' | 'miss' | 'stale'
  /**
   * Set when the outcome is an ops-visible failure mode: 'serving_stale'
   * (stale served past the error threshold) or 'grace_exhausted' (stale
   * fallback refused because the row outlived its grace window).
   */
  alert?: 'serving_stale' | 'grace_exhausted'
  expiredForSeconds?: number
}

/**
 * Records one TMDb cache decision in Sentry. No-op without SENTRY_DSN.
 * Synchronous from the caller's point of view -- all Sentry work happens on a
 * detached promise handed to `EdgeRuntime.waitUntil` (or left floating outside
 * that runtime, where losing a metric is acceptable: tests and local dev).
 */
export function recordCacheOutcome(outcome: CacheOutcome): void {
  const dsn = Deno.env.get('SENTRY_DSN')
  if (!dsn) return

  const work = (async () => {
    try {
      const Sentry = await getSentry(dsn)
      // First key segment: movie_details | browse | search -- bounded, unlike
      // the full key, which would blow up metric cardinality.
      const namespace = outcome.cacheKey.split(':', 1)[0]

      Sentry.metrics.count('tmdb_cache.requests', 1, {
        attributes: { cache_status: outcome.status, cache_namespace: namespace },
      })

      if (outcome.alert) {
        Sentry.captureMessage(STALE_ALERT_MESSAGE, {
          level: 'error',
          tags: { phase: outcome.alert, cache_namespace: namespace },
          extra: {
            cache_key: outcome.cacheKey,
            expired_for_seconds: outcome.expiredForSeconds,
          },
        })
      }

      await Sentry.flush(2000)
    } catch (monitoringError) {
      console.warn(JSON.stringify({
        level: 'warn',
        fn: 'monitoring',
        msg: 'recordCacheOutcome failed',
        error: monitoringError instanceof Error ? monitoringError.message : String(monitoringError),
      }))
    }
  })()

  const g = globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }
  g.EdgeRuntime?.waitUntil(work)
}
