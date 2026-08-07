import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

// No-op unless a DSN is configured (e.g. local dev, PR previews).
Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
})
