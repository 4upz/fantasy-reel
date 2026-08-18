/**
 * Shared TMDb HTTP client and error mapping.
 *
 * The three read-only TMDb Edge Functions (browse-movies, search-movies,
 * get-movie-details) each used to carry their own copy of the same error
 * class, the same auth headers, the same retry policy, and the same catch
 * ladder. They live here once so a change to the timeout, the retry policy or
 * the user-facing wording cannot land in two of the three.
 *
 * Only the fallback message (and the 404 wording, when a function has one)
 * differs per caller -- everything else is identical by design.
 */

import { fetchWithRetry } from './http.ts'
import { errorResponse } from './utils.ts'
import type { Logger } from './logger.ts'

/**
 * A non-2xx answer from TMDb. `body` is the raw response text when it was
 * read; it is logged (never returned) so a 502 can be diagnosed without
 * leaking TMDb's payload to the client.
 */
export class TMDbApiError extends Error {
  status: number
  body?: string

  constructor(status: number, body?: string) {
    super(`TMDb API error: ${status}`)
    this.status = status
    this.body = body
  }
}

/** Timeout/retry policy shared by every TMDb call. Idempotent GETs only. */
const TMDB_FETCH_OPTS = { timeoutMs: 10_000, retries: 1 } as const

/**
 * GET a TMDb endpoint and parse its JSON body, throwing `TMDbApiError` on any
 * non-2xx. The API token goes in the Authorization header (v4 bearer style),
 * never in the URL.
 */
export async function tmdbGetJson<T>(url: string, token: string): Promise<T> {
  const response = await fetchWithRetry(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, TMDB_FETCH_OPTS)

  if (!response.ok) {
    throw new TMDbApiError(response.status, await response.text())
  }

  return await response.json() as T
}

/**
 * Maps a `TMDbApiError` to the response the client sees.
 *
 * Reached only when the cache had nothing to fall back on -- a hit or an
 * expired entry answers a rate-limited or failing TMDb first. 401 and 429 are
 * passed through with their own wording; a 404 is only meaningful for
 * single-resource lookups, so it maps to `opts.notFoundMessage` when the
 * caller has one. Anything else is logged (with TMDb's own body, if read) and
 * reported as a 502 with `fallbackMessage`.
 */
export function tmdbErrorResponse(
  error: TMDbApiError,
  log: Logger,
  fallbackMessage: string,
  opts: { notFoundMessage?: string } = {}
): Response {
  if (error.status === 401) {
    return errorResponse('TMDb API authentication failed', 401)
  }
  if (error.status === 429) {
    return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
  }
  if (error.status === 404 && opts.notFoundMessage) {
    return errorResponse(opts.notFoundMessage, 404)
  }

  log.error('TMDb API error', { status: error.status, body: error.body })
  return errorResponse(fallbackMessage, 502)
}
