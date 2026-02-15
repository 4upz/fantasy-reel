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

  try {
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

    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return Response.json(
        { error: 'Edge Function returned non-JSON response', status: response.status },
        { status: 502 }
      )
    }

    return Response.json(data, { status: response.status })
  } catch (error) {
    console.error('Cron update-scores failed:', error)
    return Response.json(
      { error: 'Failed to call Edge Function' },
      { status: 502 }
    )
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MOCK_SUPABASE_URL = 'http://mock-supabase.local'

function setupEnv(cronSecret: string): void {
  Deno.env.set('CRON_SECRET', cronSecret)
  Deno.env.set('NEXT_PUBLIC_SUPABASE_URL', MOCK_SUPABASE_URL)
}

function createAuthorizedRequest(cronSecret: string): Request {
  return new Request('http://localhost/api/cron/update-scores', {
    headers: { authorization: `Bearer ${cronSecret}` },
  })
}

async function withMockFetch<T>(
  mockFn: typeof globalThis.fetch,
  callback: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFn
  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function resolveInputUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
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
  setupEnv(cronSecret)

  let capturedUrl = ''
  let capturedMethod = ''
  let capturedHeaders: Record<string, string> = {}

  const response = await withMockFetch(
    async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = resolveInputUrl(input)
      capturedMethod = init?.method || 'GET'
      const headers = init?.headers
      if (headers instanceof Headers) {
        headers.forEach((value, key) => { capturedHeaders[key] = value })
      } else if (headers && typeof headers === 'object') {
        capturedHeaders = { ...headers } as Record<string, string>
      }
      return Response.json({ movies_fetched: 3, scores_updated: 3, errors: [] })
    },
    () => handleCronRequest(createAuthorizedRequest(cronSecret))
  )

  assertEquals(capturedUrl, `${MOCK_SUPABASE_URL}/functions/v1/update-scores`)
  assertEquals(capturedMethod, 'POST')
  assertEquals(capturedHeaders['Content-Type'], 'application/json')
  assertEquals(capturedHeaders['X-Cron-Secret'], cronSecret)
  assertEquals(response.status, 200)
})

Deno.test('cron route: returns Edge Function response data', async () => {
  const cronSecret = 'test-secret-789'
  setupEnv(cronSecret)

  const expectedData = { movies_fetched: 10, scores_updated: 8, errors: ['movie-123 failed'] }

  const response = await withMockFetch(
    async () => Response.json(expectedData),
    () => handleCronRequest(createAuthorizedRequest(cronSecret))
  )

  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.movies_fetched, 10)
  assertEquals(body.scores_updated, 8)
  assertEquals(body.errors, ['movie-123 failed'])
})

Deno.test('cron route: forwards Edge Function error status codes', async () => {
  const cronSecret = 'test-secret-status'
  setupEnv(cronSecret)

  const response = await withMockFetch(
    async () => Response.json({ error: 'Forbidden' }, { status: 403 }),
    () => handleCronRequest(createAuthorizedRequest(cronSecret))
  )

  assertEquals(response.status, 403)
  const body = await response.json()
  assertEquals(body.error, 'Forbidden')
})

Deno.test('cron route: returns 502 for non-JSON Edge Function response', async () => {
  const cronSecret = 'test-secret-html'
  setupEnv(cronSecret)

  const response = await withMockFetch(
    async () => new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    }),
    () => handleCronRequest(createAuthorizedRequest(cronSecret))
  )

  assertEquals(response.status, 502)
  const body = await response.json()
  assertEquals(body.error, 'Edge Function returned non-JSON response')
  assertEquals(body.status, 502)
})

Deno.test('cron route: returns 502 when fetch throws (network error)', async () => {
  const cronSecret = 'test-secret-network'
  setupEnv(cronSecret)

  const response = await withMockFetch(
    async () => { throw new Error('Network error: connection refused') },
    () => handleCronRequest(createAuthorizedRequest(cronSecret))
  )

  assertEquals(response.status, 502)
  const body = await response.json()
  assertEquals(body.error, 'Failed to call Edge Function')
})
