/**
 * Lazy, DSN-gated facade over @sentry/nextjs for CLIENT code.
 *
 * Statically importing the Sentry SDK measurably slows every dev-server
 * route compile (~4-5x per first load), which degrades local dev and sent
 * the E2E suite into mass navigation timeouts. Importing it dynamically —
 * and only when NEXT_PUBLIC_SENTRY_DSN is set — keeps the SDK out of the
 * compile path and out of the browser bundle entirely for unconfigured
 * environments (local dev, E2E/CI, previews without a DSN).
 *
 * Client components should use these helpers instead of importing
 * @sentry/nextjs directly. Server-only files (instrumentation.ts,
 * sentry.server.config.ts) may keep static imports — they load once at
 * boot and don't affect route compiles.
 */

type SentryModule = typeof import('@sentry/nextjs')

let sentryPromise: Promise<SentryModule> | null = null

/**
 * Clamps to [0, 1], falling back to `fallback` when unset or unparseable.
 * NEXT_PUBLIC_ vars are inlined at build time, so this is evaluated once
 * per build, not per-request.
 */
function parseSampleRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (raw === undefined || Number.isNaN(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function loadSentry(): Promise<SentryModule> | null {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return null
  sentryPromise ??= import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: parseSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.1),
      sendDefaultPii: false,
    })
    return Sentry
  })
  return sentryPromise
}

/**
 * Eagerly load + init the client SDK (called from instrumentation-client.ts
 * at app startup so global error capture is installed as early as possible).
 * No-op without a DSN.
 */
export function initSentryClient(): void {
  loadSentry()
}

export function captureException(
  error: unknown,
  context?: Parameters<SentryModule['captureException']>[1]
): void {
  loadSentry()?.then((Sentry) => Sentry.captureException(error, context))
}

export function captureMessage(
  message: string,
  context?: Parameters<SentryModule['captureMessage']>[1]
): void {
  loadSentry()?.then((Sentry) => Sentry.captureMessage(message, context))
}

export function addBreadcrumb(
  breadcrumb: Parameters<SentryModule['addBreadcrumb']>[0]
): void {
  loadSentry()?.then((Sentry) => Sentry.addBreadcrumb(breadcrumb))
}

/** Forwards App Router transitions to Sentry once the SDK has loaded. */
export function captureRouterTransition(href: string, navigationType: string): void {
  loadSentry()?.then((Sentry) => Sentry.captureRouterTransitionStart(href, navigationType))
}
