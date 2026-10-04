import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, errorResponse } from './utils.ts'
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

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS

/**
 * Per-user throttles for Edge Functions a scripted account could use to run
 * up invocation cost, TMDb quota or other members' inboxes. Each sits well
 * above what a person clicking through the app does: about one movie lookup a
 * second sustained for five minutes, and more trades and bids in an hour than
 * a busy deadline day needs. Only automation should ever reach them.
 */
export const USER_RATE_LIMITS = {
  /** search-movies: the draft board and /movies typeahead (debounced). */
  movie_search: { max: 300, windowSeconds: 5 * MINUTE_SECONDS },
  /** browse-movies: one call per browse page. */
  movie_browse: { max: 300, windowSeconds: 5 * MINUTE_SECONDS },
  /** get-movie-details: one call per opened movie. */
  movie_details: { max: 300, windowSeconds: 5 * MINUTE_SECONDS },
  /** get-franchise-history: batches of up to 40 movies per call. */
  franchise_history: { max: 120, windowSeconds: 5 * MINUTE_SECONDS },
  /** search-users: the invite dialog's username typeahead. */
  user_search: { max: 120, windowSeconds: 5 * MINUTE_SECONDS },
  /** propose-trade: each proposal emails and posts to Discord. */
  trade_propose: { max: 30, windowSeconds: HOUR_SECONDS },
  /** counter-trade: each counter emails and posts to Discord. */
  trade_counter: { max: 30, windowSeconds: HOUR_SECONDS },
  /** place-bid: each bid can send an outbid email and a Discord post. */
  pickup_bid: { max: 60, windowSeconds: HOUR_SECONDS },
  /** place-counterpick-bid: same notifications as place-bid. */
  counterpick_bid: { max: 60, windowSeconds: HOUR_SECONDS },
} as const satisfies Record<string, { max: number; windowSeconds: number }>

export type UserRateLimitName = keyof typeof USER_RATE_LIMITS

/**
 * Counts one call by `userId` against `USER_RATE_LIMITS[name]`. Returns the
 * 429 to send when the allowance is used up, or null when the call may go on.
 *
 * A null `userId` is the service role (the Discord bot acting for a guild),
 * which is not limited per user. Without `serviceClient` one is created here;
 * if that fails the call is allowed, like any other limiter failure.
 */
export async function throttleUser(
  name: UserRateLimitName,
  userId: string | null,
  log?: Logger,
  serviceClient?: SupabaseClient
): Promise<Response | null> {
  if (!userId) return null

  let client = serviceClient
  if (!client) {
    try {
      client = createServiceClient()
    } catch (error) {
      log?.warn('rate limit client unavailable; allowing request', {
        bucket: `user:${name}`,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  const { max, windowSeconds } = USER_RATE_LIMITS[name]
  const result = await consumeRateLimit(client, { bucket: `user:${name}`, subject: userId, max, windowSeconds }, log)
  if (result.allowed) return null

  log?.warn('user rate limit reached', { bucket: `user:${name}`, user_id: userId })
  return rateLimitResponse(
    `You're doing that too often. Please try again in ${describeRetryAfter(result.retryAfterSeconds)}.`,
    result.retryAfterSeconds
  )
}
