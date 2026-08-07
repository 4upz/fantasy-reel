import * as Sentry from '@sentry/nextjs'

// No-op unless NEXT_PUBLIC_SENTRY_DSN is set (e.g. local dev, PR previews).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
