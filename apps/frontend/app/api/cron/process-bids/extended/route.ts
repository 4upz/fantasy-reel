import { proxyCronRequest } from '../../_lib/proxyCronRequest'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Hourly extended-window bid resolution. See the sibling `weekly` route for why
 * the mode is a static path segment instead of a `?mode=` query string.
 */
export async function GET(request: Request): Promise<Response> {
  return proxyCronRequest(request, 'process-bids', { mode: 'extended' })
}
