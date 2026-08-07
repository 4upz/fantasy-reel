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
 * Fetch with a bounded timeout and a single retry on network/timeout errors
 * or 5xx responses. Never retries 4xx -- those won't succeed on a retry.
 * Intended only for idempotent GETs. Returns the last response (even if not
 * ok) once retries are exhausted, or rethrows the last error if every
 * attempt failed to produce a response at all.
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
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs, fetchImpl)
      if (response.ok || response.status < 500) return response
      lastResponse = response
    } catch (error) {
      lastError = error
    }

    if (attempt < retries) {
      log.warn('outbound retry', {
        host,
        attempt: attempt + 1,
        reason: lastResponse ? `status_${lastResponse.status}` : lastError instanceof Error ? lastError.name : 'unknown',
      })
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  if (lastResponse) return lastResponse
  throw lastError
}
