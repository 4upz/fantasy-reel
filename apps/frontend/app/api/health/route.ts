// Lightweight health check for uptime monitoring. Deliberately dependency-light
// (plain fetch, no Supabase client) and unauthenticated so external monitors can
// hit it directly. Only checks Supabase reachability — third-party APIs (TMDb,
// MDBList, etc.) are intentionally excluded so their flakiness doesn't page anyone.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CheckResult = 'ok' | 'error'

// The route is public, so a flood of hits must not become a flood of Supabase
// calls. One probe answers every request for this long, per instance, and the
// CDN may serve the same answer for that long too. A few seconds is still far
// finer than any uptime monitor's interval.
const CACHE_SECONDS = 10

let cached: { result: Promise<CheckResult>; expiresAt: number } | null = null

function cachedCheckSupabase(): Promise<CheckResult> {
  const now = Date.now()
  if (!cached || cached.expiresAt <= now) {
    // Caching the promise, not the result, makes concurrent hits share one probe.
    cached = { result: checkSupabase(), expiresAt: now + CACHE_SECONDS * 1000 }
  }
  return cached.result
}

async function checkSupabase(): Promise<CheckResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return 'error'
  }

  try {
    // Hosted Supabase's API gateway rejects /auth/v1/* requests without an
    // apikey header (401 before reaching the auth service), so the probe must
    // send the public anon key or it reports a healthy project as down.
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(5_000),
    })
    return response.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function GET(): Promise<Response> {
  const supabase = await cachedCheckSupabase()
  const status: 'ok' | 'degraded' = supabase === 'ok' ? 'ok' : 'degraded'

  return Response.json(
    { status, checks: { supabase } },
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}` },
    }
  )
}
