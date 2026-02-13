/**
 * Tests for the Vercel cron route handler logic at:
 *   apps/frontend/app/api/cron/update-scores/route.ts
 *
 * Since the frontend has no unit test framework (vitest/jest), we test the
 * route's core logic here using Deno's test runner. The route is a pure
 * function: Request -> Response, so we can exercise it directly.
 *
 * We cannot import the Next.js route module (it uses NextResponse from
 * 'next/server'), so we replicate the handler logic inline and test that.
 * This ensures the auth check + proxy pattern works correctly.
 */

import { assertEquals } from '@std/assert'

// ---------------------------------------------------------------------------
// Replicate the route handler logic (mirrors route.ts exactly)
// ---------------------------------------------------------------------------

async function handleCronRequest(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const response = await fetch(
    `${Deno.env.get('NEXT_PUBLIC_SUPABASE_URL')}/functions/v1/update-scores`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': Deno.env.get('CRON_SECRET') || '',
      },
    }
  )

  const data = await response.json()
  return Response.json(data)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('cron route: returns 401 without authorization header', async () => {
  Deno.env.set('CRON_SECRET', 'test-secret-123')

  const request = new Request('http://localhost/api/cron/update-scores')
  const response = await handleCronRequest(request)

  assertEquals(response.status, 401)
  const body = await response.json()
  assertEquals(body.error, 'Unauthorized')
})

Deno.test('cron route: returns 401 with wrong CRON_SECRET', async () => {
  Deno.env.set('CRON_SECRET', 'test-secret-123')

  const request = new Request('http://localhost/api/cron/update-scores', {
    headers: { authorization: 'Bearer wrong-secret' },
  })
  const response = await handleCronRequest(request)

  assertEquals(response.status, 401)
  const body = await response.json()
  assertEquals(body.error, 'Unauthorized')
})

Deno.test('cron route: proxies to Edge Function with correct headers', async () => {
  const cronSecret = 'test-secret-456'
  const supabaseUrl = 'http://mock-supabase.local'
  Deno.env.set('CRON_SECRET', cronSecret)
  Deno.env.set('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)

  // Capture the proxied request details
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedHeaders: Record<string, string> = {}

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    capturedUrl = url
    capturedMethod = init?.method || 'GET'
    const headers = init?.headers
    if (headers instanceof Headers) {
      headers.forEach((value, key) => { capturedHeaders[key] = value })
    } else if (headers && typeof headers === 'object') {
      capturedHeaders = { ...headers } as Record<string, string>
    }
    return Response.json({ movies_fetched: 3, scores_updated: 3, errors: [] })
  }

  try {
    const request = new Request('http://localhost/api/cron/update-scores', {
      headers: { authorization: `Bearer ${cronSecret}` },
    })
    await handleCronRequest(request)

    assertEquals(capturedUrl, `${supabaseUrl}/functions/v1/update-scores`)
    assertEquals(capturedMethod, 'POST')
    assertEquals(capturedHeaders['Content-Type'], 'application/json')
    assertEquals(capturedHeaders['X-Cron-Secret'], cronSecret)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('cron route: returns Edge Function response data', async () => {
  const cronSecret = 'test-secret-789'
  Deno.env.set('CRON_SECRET', cronSecret)
  Deno.env.set('NEXT_PUBLIC_SUPABASE_URL', 'http://mock-supabase.local')

  const expectedData = { movies_fetched: 10, scores_updated: 8, errors: ['movie-123 failed'] }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return Response.json(expectedData)
  }

  try {
    const request = new Request('http://localhost/api/cron/update-scores', {
      headers: { authorization: `Bearer ${cronSecret}` },
    })
    const response = await handleCronRequest(request)

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.movies_fetched, 10)
    assertEquals(body.scores_updated, 8)
    assertEquals(body.errors, ['movie-123 failed'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
