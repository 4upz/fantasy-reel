/**
 * Sentry error tracking for Edge Functions, lazily loaded so the happy path
 * (no errors, or SENTRY_DSN unset) never pays for the import.
 */

let initialized = false
// deno-lint-ignore no-explicit-any
let sentryPromise: Promise<any> | undefined

// deno-lint-ignore no-explicit-any
async function getSentry(dsn: string): Promise<any> {
  if (!sentryPromise) {
    sentryPromise = import('npm:@sentry/deno')
  }
  const Sentry = await sentryPromise
  if (!initialized) {
    Sentry.init({ dsn, tracesSampleRate: 0 })
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
