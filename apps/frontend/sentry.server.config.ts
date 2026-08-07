import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

// Clamps to [0, 1], falling back to 0.1 when unset or unparseable.
function parseSampleRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (raw === undefined || Number.isNaN(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

// No-op unless a DSN is configured (e.g. local dev, PR previews).
Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: parseSampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE || process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    0.1
  ),
})
