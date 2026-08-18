/**
 * Unit tests for fetchWithRetry's retry policy.
 *
 * The interesting case is 429: TMDb rate-limits aggressively, and a 429 that
 * is not retried turns into a user-visible error for what is usually a
 * sub-second condition. These pin which statuses retry and how long the wait
 * is, including that a hostile `Retry-After` cannot stall an Edge Function.
 */

import { assertEquals, assertRejects } from '@std/assert'
import { fetchWithRetry, MAX_RETRY_AFTER_MS, retryDelayMs } from './http.ts'

const URL_UNDER_TEST = 'https://api.themoviedb.org/3/movie/1'

/** A fetch stub answering with the given responses in order, recording calls. */
function stubResponses(responses: Array<Response | Error>) {
  let calls = 0
  const impl = ((): Promise<Response> => {
    const next = responses[Math.min(calls, responses.length - 1)]
    calls++
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }) as typeof fetch
  return { impl, callCount: () => calls }
}

function rateLimited(retryAfter?: string): Response {
  return new Response('rate limited', {
    status: 429,
    headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
  })
}

/** A response whose body records whether it was cancelled. */
function cancelTracking(status: number): { response: Response; wasCancelled: () => boolean } {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('body'))
      controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  return { response: new Response(body, { status }), wasCancelled: () => cancelled }
}

Deno.test('fetchWithRetry - retries a 429 and returns the recovered response', async () => {
  const { impl, callCount } = stubResponses([rateLimited('0'), new Response('ok', { status: 200 })])

  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 0 }, impl)

  assertEquals(response.status, 200)
  assertEquals(callCount(), 2)
})

Deno.test('fetchWithRetry - returns the 429 once retries are exhausted', async () => {
  const { impl, callCount } = stubResponses([rateLimited('0')])

  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 0 }, impl)

  // Still a 429: callers map it to their own error (or a stale cache entry).
  assertEquals(response.status, 429)
  assertEquals(callCount(), 2)
})

Deno.test('fetchWithRetry - Retry-After wins over the caller backoff', async () => {
  const { impl } = stubResponses([rateLimited('0'), new Response('ok', { status: 200 })])

  const start = performance.now()
  await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 10_000 }, impl)
  const elapsed = performance.now() - start

  // Retry-After: 0 means "now", so the 10s backoff must not have been used.
  assertEquals(elapsed < 1_000, true, `waited ${elapsed}ms`)
})

Deno.test('retryDelayMs - an outsized Retry-After is capped at 2s', () => {
  // Asserted on the computation rather than by timing a real sleep: an hour of
  // Retry-After must not cost the test suite (or an Edge Function) the wait.
  assertEquals(retryDelayMs(rateLimited('3600'), 0), MAX_RETRY_AFTER_MS)
  assertEquals(MAX_RETRY_AFTER_MS, 2_000)

  // Under the cap the server's own value is honored verbatim.
  assertEquals(retryDelayMs(rateLimited('1'), 0), 1_000)
  assertEquals(retryDelayMs(rateLimited('0'), 10_000), 0)

  // Non-429s, unparseable and negative values fall back to the caller backoff.
  assertEquals(retryDelayMs(new Response('boom', { status: 503 }), 500), 500)
  assertEquals(retryDelayMs(rateLimited('Wed, 18 Aug 2026 12:00:00 GMT'), 500), 500)
  assertEquals(retryDelayMs(rateLimited('  '), 500), 500)
  assertEquals(retryDelayMs(rateLimited('-5'), 500), 500)
  assertEquals(retryDelayMs(undefined, 500), 500)
})

Deno.test('fetchWithRetry - an unparseable Retry-After falls back to the backoff', async () => {
  // TMDb sends seconds, but the spec also allows an HTTP-date; rather than
  // half-parse one, fall back to the caller's backoff.
  const { impl, callCount } = stubResponses([
    rateLimited('Wed, 18 Aug 2026 12:00:00 GMT'),
    new Response('ok', { status: 200 }),
  ])

  const start = performance.now()
  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 20 }, impl)
  const elapsed = performance.now() - start

  assertEquals(response.status, 200)
  assertEquals(callCount(), 2)
  assertEquals(elapsed < 1_000, true, `waited ${elapsed}ms`)
})

Deno.test('fetchWithRetry - a 429 with no Retry-After uses the backoff', async () => {
  const { impl, callCount } = stubResponses([rateLimited(), new Response('ok', { status: 200 })])

  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 20 }, impl)

  assertEquals(response.status, 200)
  assertEquals(callCount(), 2)
})

Deno.test('fetchWithRetry - still retries 5xx', async () => {
  const { impl, callCount } = stubResponses([
    new Response('boom', { status: 503 }),
    new Response('ok', { status: 200 }),
  ])

  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 0 }, impl)

  assertEquals(response.status, 200)
  assertEquals(callCount(), 2)
})

Deno.test('fetchWithRetry - never retries other 4xx', async () => {
  const { impl, callCount } = stubResponses([
    new Response('nope', { status: 404 }),
    new Response('ok', { status: 200 }),
  ])

  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 0 }, impl)

  assertEquals(response.status, 404)
  assertEquals(callCount(), 1)
})

Deno.test('fetchWithRetry - retries thrown errors and rethrows when none produced a response', async () => {
  const { impl, callCount } = stubResponses([new Error('network down')])

  await assertRejects(
    () => fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 0 }, impl),
    Error,
    'network down'
  )
  assertEquals(callCount(), 2)
})

Deno.test('fetchWithRetry - a superseded retryable response has its body cancelled', async () => {
  const first = cancelTracking(429)
  const second = cancelTracking(200)
  const { impl } = stubResponses([first.response, second.response])
  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { retries: 1, backoffMs: 0 }, impl)
  assertEquals(response.status, 200)
  assertEquals(first.wasCancelled(), true)
  // The returned response stays consumable.
  assertEquals(second.wasCancelled(), false)
  assertEquals(await response.text(), 'body')
})

Deno.test('fetchWithRetry - a later network error still returns an earlier response', async () => {
  const { impl } = stubResponses([new Response('boom', { status: 503 }), new Error('network down')])

  const response = await fetchWithRetry(URL_UNDER_TEST, {}, { backoffMs: 0 }, impl)

  assertEquals(response.status, 503)
})
