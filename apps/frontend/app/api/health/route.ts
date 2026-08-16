// Lightweight health check for uptime monitoring. Deliberately dependency-light
// (plain fetch, no Supabase client) and unauthenticated so external monitors can
// hit it directly. Only checks Supabase reachability — third-party APIs (TMDb,
// MDBList, etc.) are intentionally excluded so their flakiness doesn't page anyone.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CheckResult = 'ok' | 'error'

async function checkSupabase(): Promise<CheckResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    return 'error'
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    return response.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function GET(): Promise<Response> {
  const supabase = await checkSupabase()
  const status: 'ok' | 'degraded' = supabase === 'ok' ? 'ok' : 'degraded'

  return Response.json(
    { status, checks: { supabase } },
    { status: status === 'ok' ? 200 : 503 }
  )
}
