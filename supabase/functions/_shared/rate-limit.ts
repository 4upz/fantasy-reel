import type { SupabaseClient } from '@supabase/supabase-js'
import { errorResponse } from './utils.ts'
import type { Logger } from './logger.ts'

/**
 * Per-subject fixed-window rate limits, backed by the service-role-only
 * `consume_rate_limit` RPC (`rate_limit_counters` table).
 *
 * Call `consumeRateLimit` with a service-role client right before the costly
 * step (after validation, so rejected requests don't use up the allowance),
 * and return `rateLimitResponse` when it is refused.
 */

export interface RateLimit {
  /** Stable name for what is being limited, e.g. `invite_email:owner`. */
  bucket: string
  /** Who or what the limit is per: a user id, a hash, a composite key. */
  subject: string
  max: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSeconds: number
}

/**
 * Counts one use against `limit`. Fails open: if the counter can't be read
 * (database error, migration not yet applied) the call is allowed and logged,
 * so an outage of the limiter never blocks legitimate users.
 */
export async function consumeRateLimit(
  serviceClient: SupabaseClient,
  limit: RateLimit,
  log?: Logger
): Promise<RateLimitResult> {
  const { data, error } = await serviceClient.rpc('consume_rate_limit', {
    p_bucket: limit.bucket,
    p_subject: limit.subject,
    p_max: limit.max,
    p_window_seconds: limit.windowSeconds,
  })

  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) {
    log?.warn('rate limit check failed; allowing request', {
      bucket: limit.bucket,
      error: error?.message ?? 'no row returned',
    })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  return { allowed: row.allowed === true, retryAfterSeconds: Number(row.retry_after_seconds) || 0 }
}

/** "about 3 hours", "about 1 hour", "12 minutes", "1 minute". */
export function describeRetryAfter(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'about 1 hour' : `about ${hours} hours`
}

/** 429 with a `Retry-After` header and `retry_after_seconds` in the body. */
export function rateLimitResponse(message: string, retryAfterSeconds: number): Response {
  const response = errorResponse(message, 429, { retry_after_seconds: retryAfterSeconds })
  response.headers.set('Retry-After', String(retryAfterSeconds))
  return response
}

/** Hex SHA-256, for subjects (like email addresses) that shouldn't be stored in clear. */
export async function hashSubject(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
