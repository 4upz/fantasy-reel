import { assertEquals } from '@std/assert'
import { getCorsHeaders } from './cors.ts'

function preflight(origin: string | null, requestedHeaders: string | null): Request {
  const headers = new Headers({ 'Access-Control-Request-Method': 'POST' })
  if (origin) headers.set('Origin', origin)
  if (requestedHeaders) headers.set('Access-Control-Request-Headers', requestedHeaders)

  return new Request('https://example.test/functions/v1/get-trades', {
    method: 'OPTIONS',
    headers,
  })
}

function allowedHeaders(response: Record<string, string>): string[] {
  return response['Access-Control-Allow-Headers'].split(',').map((h) => h.trim())
}

Deno.test('getCorsHeaders', async (t) => {
  await t.step('allows the Sentry trace headers the frontend attaches to every fetch', () => {
    // Regression: Sentry propagates sentry-trace/baggage to all URLs unless
    // tracePropagationTargets is set. When these were missing from the allow
    // list, the preflight failed, the browser never sent the POST, and every
    // Edge Function call in the app died as an opaque
    // "Failed to send a request to the Edge Function".
    const headers = getCorsHeaders(
      preflight('https://www.fantasyreel.com', 'authorization, content-type, sentry-trace, baggage')
    )

    const allowed = allowedHeaders(headers)
    assertEquals(allowed.includes('sentry-trace'), true)
    assertEquals(allowed.includes('baggage'), true)
  })

  await t.step('allows the baseline headers even when nothing is requested', () => {
    const allowed = allowedHeaders(getCorsHeaders(preflight('https://www.fantasyreel.com', null)))

    for (const header of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
      assertEquals(allowed.includes(header), true, `expected ${header} to be allowed`)
    }
  })

  await t.step('reflects an unanticipated header rather than failing the preflight', () => {
    const allowed = allowedHeaders(
      getCorsHeaders(preflight('https://www.fantasyreel.com', 'x-some-future-sdk-header'))
    )

    assertEquals(allowed.includes('x-some-future-sdk-header'), true)
    // Baseline is still present alongside the reflected header.
    assertEquals(allowed.includes('authorization'), true)
  })

  await t.step('does not duplicate a requested header already in the baseline', () => {
    const allowed = allowedHeaders(
      getCorsHeaders(preflight('https://www.fantasyreel.com', 'Authorization, CONTENT-TYPE'))
    )

    assertEquals(allowed.filter((h) => h === 'authorization').length, 1)
    assertEquals(allowed.filter((h) => h === 'content-type').length, 1)
  })

  await t.step('echoes an allowlisted origin back to the caller', () => {
    const headers = getCorsHeaders(preflight('https://www.fantasyreel.com', null))
    assertEquals(headers['Access-Control-Allow-Origin'], 'https://www.fantasyreel.com')
  })

  await t.step('does not echo an unknown origin', () => {
    const headers = getCorsHeaders(preflight('https://evil.example.com', null))
    assertEquals(headers['Access-Control-Allow-Origin'], 'https://fantasyreel.com')
  })

  await t.step('varies on Origin so caches cannot cross-serve the allow-origin', () => {
    const headers = getCorsHeaders(preflight('https://www.fantasyreel.com', null))
    assertEquals(headers['Vary'].includes('Origin'), true)
  })
})
