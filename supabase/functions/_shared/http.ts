/**
 * Fetch helpers for outbound HTTP calls: a bounded timeout, and a minimal
 * retry for idempotent GETs.
 */

/**
 * Fetch with a bounded timeout via AbortSignal.timeout. If `init` already
 * carries a signal, both it and the timeout can abort the request
 * (AbortSignal.any). On timeout, the underlying fetch throws a DOMException
 * named 'TimeoutError' -- callers' existing catch blocks handle it like any
 * other fetch failure.
 *
 * `fetchImpl` defaults to the global fetch; only sync-release-dates/handler.ts
 * passes an injected one, for testability.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  return fetchImpl(url, { ...init, signal })
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
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  if (lastResponse) return lastResponse
  throw lastError
}
