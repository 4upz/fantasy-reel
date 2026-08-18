/**
 * Fetch helpers for outbound HTTP calls: a bounded timeout, and a minimal
 * retry for idempotent GETs.
 */

import { createLogger } from './logger.ts'

const log = createLogger('shared/http')

/**
 * Host only -- never the full URL. Query strings carry API keys for TMDb/
 * MDBList, so logging anything beyond `host` would leak secrets into logs.
 */
function hostOf(url: string | URL): string {
  try {
    return new URL(url).host
  } catch {
    return 'unknown'
  }
}

/**
 * Fetch with a bounded timeout via AbortSignal.timeout. If `init` already
 * carries a signal, both it and the timeout can abort the request
 * (AbortSignal.any). On timeout, the underlying fetch throws a DOMException
 * named 'TimeoutError' -- callers' existing catch blocks handle it like any
 * other fetch failure.
 *
 * `fetchImpl` defaults to the global fetch; only sync-release-dates/handler.ts
 * passes an injected one, for testability.
 *
 * Every call is logged once as a single structured line -- success/4xx at
 * info, 5xx or a thrown error (including timeout) at warn -- so outbound
 * latency/error rates per host are answerable from logs alone.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  const host = hostOf(url)
  const method = init.method ?? 'GET'
  const start = performance.now()

  try {
    const response = await fetchImpl(url, { ...init, signal })
    const duration_ms = Math.round(performance.now() - start)
    const fields = { host, method, status: response.status, duration_ms }
    if (response.status >= 500) {
      log.warn('outbound', fields)
    } else {
      log.info('outbound', fields)
    }
    return response
  } catch (error) {
    const duration_ms = Math.round(performance.now() - start)
    log.warn('outbound failed', {
      host,
      method,
      duration_ms,
      error_name: error instanceof Error ? error.name : 'Unknown',
    })
    throw error
  }
}

/**
 * Upper bound on how long a server's `Retry-After` may hold a request. Edge
 * Functions answer a user waiting on a page; TMDb's 429s clear in about a
 * second, so anything longer is better spent failing over to a stale cache
 * entry than blocking.
 */
const MAX_RETRY_AFTER_MS = 2_000

/**
 * How long to wait before the next attempt: a 429's `Retry-After` (seconds,
 * capped) when the server gave a usable one, otherwise the caller's backoff.
 * `Retry-After` may also be an HTTP-date, which is not parsed -- those fall
 * back to the plain backoff rather than risking a long, badly-parsed wait.
 */
function retryDelayMs(response: Response | undefined, backoffMs: number): number {
  if (response?.status !== 429) return backoffMs

  // Number('') is 0, which would mean "retry instantly" -- treat a blank
  // header as absent instead.
  const header = response.headers.get('Retry-After')?.trim()
  const seconds = header ? Number(header) : NaN
  if (!Number.isFinite(seconds) || seconds < 0) return backoffMs

  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

/**
 * Fetch with a bounded timeout and a single retry on network/timeout errors,
 * 5xx responses, or 429 rate limits. A 429 honors the server's `Retry-After`
 * header (in seconds, capped at 2s) and otherwise uses the caller's backoff.
 * Never retries any other 4xx -- those won't succeed on a retry. Intended
 * only for idempotent GETs. Returns the last response (even if not ok) once
 * retries are exhausted, or rethrows the last error if every attempt failed
 * to produce a response at all.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number; backoffMs?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const { timeoutMs = 10_000, retries = 1, backoffMs = 500 } = opts
  const host = hostOf(url)

  let lastError: unknown
  let lastResponse: Response | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Distinct from `lastResponse` (which is sticky across attempts, so a
    // later network error still returns an earlier response): the delay must
    // reflect *this* attempt's Retry-After, not a previous one's.
    let attemptResponse: Response | undefined
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs, fetchImpl)
      if (response.ok || (response.status < 500 && response.status !== 429)) return response
      attemptResponse = response
      lastResponse = response
    } catch (error) {
      lastError = error
    }

    if (attempt < retries) {
      const delayMs = retryDelayMs(attemptResponse, backoffMs)
      log.warn('outbound retry', {
        host,
        attempt: attempt + 1,
        delay_ms: delayMs,
        reason: attemptResponse ? `status_${attemptResponse.status}` : lastError instanceof Error ? lastError.name : 'unknown',
      })
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  if (lastResponse) return lastResponse
  throw lastError
}
