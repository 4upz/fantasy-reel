const PRODUCTION_ORIGINS = [
  'https://fantasyreel.com',
  'https://www.fantasyreel.com',
  'https://fantasy-reel.vercel.app',
]

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

/**
 * Request headers every function accepts.
 *
 * `sentry-trace` and `baggage` are not optional extras: the frontend's Sentry
 * SDK injects them into *every* outgoing fetch, because `shouldPropagateTraceForUrl`
 * propagates to all URLs unless `tracePropagationTargets` is set, and our
 * `Sentry.init` (apps/frontend/utils/sentry.ts) deliberately leaves it unset.
 * Leaving them out of this list fails the preflight, so the browser never sends
 * the real request and supabase-js reports the fetch-level
 * "Failed to send a request to the Edge Function" -- for every Edge Function
 * call in the app at once. See the preflight reflection below.
 */
const BASE_ALLOWED_HEADERS = [
  'authorization',
  'apikey',
  'content-type',
  'x-client-info',
  'x-cron-secret',
  'x-request-id',
  'sentry-trace',
  'baggage',
]

function isLocalDevelopment(): boolean {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  return supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')
}

function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) {
    return PRODUCTION_ORIGINS[0]
  }

  if (PRODUCTION_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }

  if (isLocalDevelopment() && DEV_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }

  return PRODUCTION_ORIGINS[0]
}

/**
 * Echo back whatever the preflight asked for, on top of the baseline list.
 *
 * Allow-Headers is not a security boundary -- the origin allowlist above and
 * each function's own auth check are. Reflecting the request means a client SDK
 * that starts sending a new header (exactly how `baggage` broke every browser
 * call to every function) degrades to "traced request still works" instead of
 * an app-wide outage that only shows up as a generic fetch failure.
 */
function getAllowedHeaders(requestedHeaders: string | null): string {
  const requested = (requestedHeaders ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)

  return [...new Set([...BASE_ALLOWED_HEADERS, ...requested])].join(', ')
}

export function getCorsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(request.headers.get('origin')),
    'Access-Control-Allow-Headers': getAllowedHeaders(
      request.headers.get('access-control-request-headers')
    ),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    // The response body is origin-independent but these headers are not, so any
    // shared cache must key on both or it will hand one origin another's
    // Allow-Origin and the browser will reject the response.
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}

/**
 * @deprecated Use getCorsHeaders(request) for proper origin validation.
 * This static export defaults to production origin for backward compatibility.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': PRODUCTION_ORIGINS[0],
  'Access-Control-Allow-Headers': BASE_ALLOWED_HEADERS.join(', '),
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}
