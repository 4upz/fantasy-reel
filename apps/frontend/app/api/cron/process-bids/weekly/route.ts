import { proxyCronRequest } from '../../_lib/proxyCronRequest'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Weekly bid resolution (Saturdays). The mode lives in the route path rather
 * than a `?mode=` query string so Sentry's Vercel cron instrumentation can
 * match this run to its monitor — it compares each vercel.json `path` against
 * the Next.js route, which carries no query string. For the same reason this
 * must stay a static segment: a dynamic `[mode]` would report as
 * `/api/cron/process-bids/[mode]` and never match either literal path.
 */
export async function GET(request: Request): Promise<Response> {
  return proxyCronRequest(request, 'process-bids', { mode: 'weekly' })
}
