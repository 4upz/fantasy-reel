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

  await t.step('allows this project\'s Vercel branch aliases and deployment URLs', () => {
    const origins = [
      'https://fantasy-reel-frontend-git-codex-lea-01de51-arik-smiths-projects.vercel.app',
      'https://fantasy-reel-frontend-git-codex-hom-b0e6fd-arik-smiths-projects.vercel.app',
      'https://fantasy-reel-frontend-qsm1jzimx-arik-smiths-projects.vercel.app',
    ]

    for (const origin of origins) {
      const headers = getCorsHeaders(preflight(origin, 'authorization, content-type, sentry-trace, baggage'))
      assertEquals(headers['Access-Control-Allow-Origin'], origin)
      assertEquals(headers['Access-Control-Allow-Credentials'], 'true')
      assertEquals(allowedHeaders(headers).includes('sentry-trace'), true)
      assertEquals(allowedHeaders(headers).includes('baggage'), true)
    }
  })

  await t.step('rejects other Vercel projects, teams, and lookalike preview origins', () => {
    const origins = [
      'https://other-project-git-main-arik-smiths-projects.vercel.app',
      'https://fantasy-reel-frontend-git-main-other-team.vercel.app',
      'https://fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app.evil.example',
      'https://evil.fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app',
      'https://fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app@evil.example',
      'https://evil.example/fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app',
      'http://fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app',
      'https://fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app:8080',
      'https://fantasy-reel-frontend-git-main-arik-smiths-projects.vercel.app/path',
      'null',
    ]

    for (const origin of origins) {
      const headers = getCorsHeaders(preflight(origin, null))
      assertEquals(headers['Access-Control-Allow-Origin'], 'https://fantasyreel.com', origin)
    }
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
