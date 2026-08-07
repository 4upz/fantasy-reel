// Client-side Sentry bootstrap. The SDK is loaded lazily via the DSN-gated
// facade in utils/sentry.ts — no DSN (local dev, E2E/CI) means the SDK is
// never compiled into route loads or downloaded by the browser.
import { initSentryClient, captureRouterTransition } from '@/utils/sentry'

initSentryClient()

export const onRouterTransitionStart = captureRouterTransition
