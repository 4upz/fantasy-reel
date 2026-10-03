import { createClient, isAuthRetryableFetchError, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getCorsHeaders } from './cors.ts'
import { getCurrentRequest, getRequestId, setRequestContext } from './request-context.ts'
import { createLogger, serializeError, type Logger } from './logger.ts'
import { captureException } from './monitoring.ts'

export { setRequestContext }

/**
 * Create a service role Supabase client for admin operations.
 * Bypasses RLS — use only in Edge Functions for operations requiring elevated access.
 */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url) throw new Error('Missing SUPABASE_URL environment variable')
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  return createClient(url, key)
}

function getCurrentCorsHeaders(): Record<string, string> {
  const currentRequest = getCurrentRequest()
  if (currentRequest) {
    return getCorsHeaders(currentRequest)
  }
  return corsHeaders
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCurrentCorsHeaders(), 'Content-Type': 'application/json', 'X-Request-Id': getRequestId() }
  })
}

export interface AuthResult {
  user: User
  supabase: SupabaseClient
}

export async function authenticateRequest(req: Request): Promise<AuthResult | Response> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) return errorResponse('Unauthorized', 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: { Authorization: authorization },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error && (isAuthRetryableFetchError(error) || (error.status !== undefined && error.status >= 500 && error.status < 600))) {
    // An unavailable identity provider cannot establish whether a token is valid.
    // Keep upstream response bodies and credentials out of logs and responses.
    createLogger('auth').error('Authentication service unavailable', {
      error_type: error.name,
      status: error.status,
    })
    return errorResponse('Authentication service is temporarily unavailable. Please try again.', 503)
  }

  if (error || !user) {
    return errorResponse('Unauthorized', 401)
  }

  return { user, supabase }
}

export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response
}

/**
 * Constant-time string comparison, so a wrong secret cannot be narrowed
 * character by character from response timing. Length is compared up front:
 * the service role key's length is not the secret, its content is.
 */
function secretsMatch(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Whether the caller presented the service role key as its bearer token.
 *
 * This is the Discord bot's path (apps/discord-bot/src/utils/functions-client.ts):
 * it acts for a whole guild rather than one signed-in user, so it has no
 * session JWT to send. An unset SUPABASE_SERVICE_ROLE_KEY never authorizes --
 * a missing secret must not open an endpoint up.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = req.headers.get('Authorization')
  if (!serviceRoleKey || !authorization) return false
  return secretsMatch(authorization, `Bearer ${serviceRoleKey}`)
}

/**
 * Authorizes an endpoint that needs *a* caller but no particular one: any
 * signed-in user, or the service role key.
 *
 * The TMDb read endpoints (browse-movies, search-movies, get-movie-details)
 * use this. They run before any league context, so there is no membership or
 * role to check -- but they do spend the league's TMDb quota, and every one of
 * them carries `verify_jwt = false` (the CLI's ES256 bug), so without this
 * anyone holding the public anon key could drive TMDb traffic through them.
 *
 * Returns null when the request may proceed, or the authentication error response.
 */
export async function authenticateUserOrServiceRole(req: Request): Promise<Response | null> {
  // A missing header never reaches Auth or the service-role comparison.
  if (!req.headers.get('Authorization')) return errorResponse('Unauthorized', 401)
  if (isServiceRoleRequest(req)) return null

  const result = await authenticateRequest(req)
  return isAuthError(result) ? result : null
}

export function isInvitationExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

/**
 * Whether a scheduled-job request may run: the X-Cron-Secret header matches
 * CRON_SECRET, or the caller presents the service role key. An unset secret
 * never authorizes -- a missing CRON_SECRET must not open the endpoint up.
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('X-Cron-Secret') === cronSecret) return true

  return isServiceRoleRequest(req)
}

export function errorResponse(
  message: string,
  status = 500,
  /**
   * Extra fields merged into the response body, for a 4xx the UI can act on
   * rather than only display -- e.g. which trade items a validation failure
   * was about. Keep it to data the client needs; `error` stays the message.
   */
  details?: Record<string, unknown>
): Response {
  const base = status >= 500 ? { error: message, request_id: getRequestId() } : { error: message }
  const body = details ? { ...base, ...details } : base
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCurrentCorsHeaders(), 'Content-Type': 'application/json', 'X-Request-Id': getRequestId() }
  })
}

/**
 * Standard handler for an outer catch: logs the error, fires (but does not
 * await) error tracking, and returns the opaque 500 response. Monitoring
 * runs via EdgeRuntime.waitUntil when available so it can finish after the
 * response is sent without delaying it; otherwise it's fire-and-forget,
 * since the isolate may be torn down before an unawaited promise settles.
 */
export function internalErrorResponse(err: unknown, log?: Logger): Response {
  const logger = log ?? createLogger('edge')
  logger.error('Unhandled error', { error: serializeError(err) })

  const capture = captureException(err)
  const g = globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }
  if (g.EdgeRuntime?.waitUntil) {
    g.EdgeRuntime.waitUntil(capture)
  } else {
    void capture
  }

  return errorResponse('Internal server error', 500)
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidUUID(id: string): boolean {
  return Boolean(id) && UUID_REGEX.test(id)
}

export function isValidEmail(email: string): boolean {
  return Boolean(email) && EMAIL_REGEX.test(email)
}

export function handleCorsPreflightRequest(req: Request): Response | null {
  setRequestContext(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  return null
}

export interface DraftEligibilityResult {
  valid: boolean
  reason?: string
}

/**
 * Whether a movie is still eligible to be acquired in a given season.
 *
 * The year cutoff is the *season's* year, not the wall-clock one. A league is
 * one season of a series (`leagues.season_year`), and the two drift apart
 * routinely: a 2026 season that runs into January 2027 must still judge its
 * movies against 2026, or every remaining title in the pool becomes "released
 * in a previous season" the moment the calendar rolls over. Callers pass
 * `league.season_year`; the handful with no league in scope (search-movies)
 * pass the current year explicitly, which is the old behaviour.
 *
 * The already-released check stays anchored to today: a movie that is out is
 * out, whatever season it belongs to.
 */
export function isUpcomingMovie(
  releaseDate: string | null | undefined,
  seasonYear: number
): DraftEligibilityResult {
  if (!releaseDate) {
    return { valid: false, reason: 'Movie has no release date' }
  }

  const today = utcDate()

  const releaseYear = parseInt(releaseDate.split('-')[0], 10)
  if (isNaN(releaseYear) || releaseYear < seasonYear) {
    return { valid: false, reason: 'Movie was released in a previous season' }
  }

  if (releaseDate < today) {
    return { valid: false, reason: 'Movie has already been released' }
  }

  return { valid: true }
}

/** Why a movie can no longer be bid on, as process-bids records it on a cancelled bid. */
export type BidLockCode = 'movie_released' | 'movie_scored'

/**
 * Why a movie can no longer be bid on -- picked up, or counterpicked by bid --
 * or null while it still can.
 *
 * A released movie is out of play (isUpcomingMovie). So is a scored one: once
 * it has a Tomatometer (`fantasy_points`, NULL until then) its outcome is
 * known, and a scored movie is locked against bids and trades, released or not.
 * Placement refuses with `reason`; process-bids cancels a bid still pending on
 * the movie, uncharged, recording `code`.
 */
export function bidLock(
  movie: { release_date: string | null | undefined; fantasy_points: number | null | undefined },
  seasonYear: number
): { code: BidLockCode; reason: string } | null {
  const release = isUpcomingMovie(movie.release_date, seasonYear)
  if (!release.valid) {
    return { code: 'movie_released', reason: release.reason ?? 'Movie has already been released' }
  }
  if (movie.fantasy_points != null) {
    return { code: 'movie_scored', reason: 'Movie already has a score' }
  }
  return null
}

/** Today's UTC calendar date (YYYY-MM-DD), the calendar release dates are judged on. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Whether a movie's points count toward team totals: from its release date on.
 * Mirrors movie_has_released() in SQL. A movie can be scored before release,
 * but that pre-release score only counts from this day.
 *
 * Deliberately not isUpcomingMovie's boundary (or movie_release_boundary() in
 * SQL), which keeps a movie open to drafts, bids and drops through its release
 * day. Scoring has always counted a movie from its release day itself.
 */
export function hasReleased(releaseDate: string | null, today: string): boolean {
  return releaseDate !== null && releaseDate <= today
}

// Characters for join codes - excludes ambiguous chars (0, O, I, 1, L)
const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateJoinCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  }
  return code
}

const JOIN_CODE_REGEX = /^[A-HJ-KM-NP-Z2-9]{6}$/

export function isValidJoinCode(code: string): boolean {
  return Boolean(code) && JOIN_CODE_REGEX.test(code.toUpperCase())
}
