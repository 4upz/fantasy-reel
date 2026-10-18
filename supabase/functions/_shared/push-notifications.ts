/**
 * Push delivery to the iOS app through Apple Push Notification service (O-01).
 *
 * Rows come from `push_outbox`, which a trigger fills on every `notifications`
 * insert for each of the recipient's phones whose category is switched on
 * (see 20261018120100_push_notifications.sql). This module leases a batch with
 * `claim_push_notifications`, sends each to APNs over HTTP/2 with a token-based
 * (.p8) provider JWT, and reports outcomes with `finish_push_notifications`.
 *
 * Needs three Edge Function secrets: APNS_KEY_P8 (the whole .p8 file),
 * APNS_KEY_ID and APNS_TEAM_ID. Without them the job does nothing, and queued
 * pushes are expired by the purge rather than sent late.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchWithTimeout } from './http.ts'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/push-notifications')

// ============================================================================
// What a push looks like
// ============================================================================

/**
 * iOS interruption levels. Time sensitive breaks through Focus, so it is kept
 * for things the person has to act on soon; passive lands quietly in
 * Notification Center.
 */
export type InterruptionLevel = 'passive' | 'active' | 'time-sensitive'

const TIME_SENSITIVE = new Set(['draft_turn', 'outbid', 'trade_proposed', 'trade_countered', 'trade_review'])
const PASSIVE = new Set(['pickup_available', 'league_movie_scored'])

export function interruptionLevel(type: string): InterruptionLevel {
  if (TIME_SENSITIVE.has(type)) return 'time-sensitive'
  if (PASSIVE.has(type)) return 'passive'
  return 'active'
}

/** A leased `push_outbox` row, as `claim_push_notifications` returns it. */
export interface ClaimedPush {
  id: string
  lease_token: string
  attempts: number
  notification_id: string
  type: string
  title: string
  body: string
  league_id: string | null
  data: Record<string, unknown> | null
  created_at: string
  token: string
  environment: 'sandbox' | 'production'
  bundle_id: string
  badge: number
}

/**
 * APNs payload: alert, badge, and grouping per league. The app decides where a
 * tap goes from `type` and `league_id`, exactly as a tap in its inbox does.
 */
export function buildPayload(push: ClaimedPush): Record<string, unknown> {
  const level = interruptionLevel(push.type)
  return {
    aps: {
      alert: { title: push.title, body: push.body },
      badge: push.badge,
      ...(level === 'passive' ? {} : { sound: 'default' }),
      'interruption-level': level,
      'thread-id': push.league_id ?? 'account',
    },
    notification_id: push.notification_id,
    type: push.type,
    league_id: push.league_id,
  }
}

// ============================================================================
// APNs
// ============================================================================

export interface ApnsCredentials {
  keyP8: string
  keyId: string
  teamId: string
}

export function apnsCredentialsFromEnv(env: { get(key: string): string | undefined } = Deno.env): ApnsCredentials | null {
  const keyP8 = env.get('APNS_KEY_P8')?.trim()
  const keyId = env.get('APNS_KEY_ID')?.trim()
  const teamId = env.get('APNS_TEAM_ID')?.trim()
  return keyP8 && keyId && teamId ? { keyP8, keyId, teamId } : null
}

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
}

/**
 * The provider token. Apple refuses one older than an hour and throttles
 * refreshing more than every 20 minutes, so it is reused for 50 minutes.
 */
export class ApnsTokenSigner {
  private cached: { jwt: string; issuedAt: number } | null = null
  private key: Promise<CryptoKey> | null = null

  constructor(private readonly credentials: ApnsCredentials, private readonly now: () => number = Date.now) {}

  async token(): Promise<string> {
    const nowMs = this.now()
    if (this.cached && nowMs - this.cached.issuedAt < 50 * 60_000) return this.cached.jwt
    this.key ??= crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8(this.credentials.keyP8),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.credentials.keyId }))
    const claims = base64url(JSON.stringify({ iss: this.credentials.teamId, iat: Math.floor(nowMs / 1000) }))
    const signingInput = `${header}.${claims}`
    // WebCrypto returns the raw r||s signature JWS expects.
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await this.key,
      new TextEncoder().encode(signingInput),
    )
    const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`
    this.cached = { jwt, issuedAt: nowMs }
    return jwt
  }

  /** Apple said the token is invalid or expired: sign a new one next time. */
  reset(): void {
    this.cached = null
  }
}

export type PushOutcome = 'sent' | 'retry' | 'failed' | 'unregistered'

/**
 * Turns an APNs response into an outbox outcome. A dead token (410, or a
 * 400 BadDeviceToken) deletes the device; a token minted for another app or
 * environment is dead to us too. Throttling, provider-token trouble and
 * Apple's own errors are retried.
 */
export function classifyApnsResponse(status: number, reason: string | undefined): PushOutcome {
  if (status === 200) return 'sent'
  if (status === 410) return 'unregistered'
  if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) return 'unregistered'
  if (status === 403 || status === 429 || status >= 500) return 'retry'
  return 'failed'
}

const APNS_HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
} as const

export interface SendResult {
  outcome: PushOutcome
  error?: string
}

export async function sendToApns(
  push: ClaimedPush,
  signer: ApnsTokenSigner,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const level = interruptionLevel(push.type)
  let response: Response
  try {
    response = await fetchWithTimeout(
      `${APNS_HOSTS[push.environment]}/3/device/${push.token}`,
      {
        method: 'POST',
        headers: {
          authorization: `bearer ${await signer.token()}`,
          'apns-topic': push.bundle_id,
          'apns-push-type': 'alert',
          // Passive pushes may be batched to save the battery.
          'apns-priority': level === 'passive' ? '5' : '10',
          // A push nobody saw within a day is old news.
          'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
          'apns-collapse-id': push.notification_id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildPayload(push)),
      },
      10_000,
      fetchImpl,
    )
  } catch (error) {
    return { outcome: 'retry', error: error instanceof Error ? error.name : 'network error' }
  }

  if (response.status === 200) {
    await response.body?.cancel()
    return { outcome: 'sent' }
  }
  let reason: string | undefined
  try {
    reason = ((await response.json()) as { reason?: string }).reason
  } catch {
    reason = undefined
  }
  if (response.status === 403) signer.reset()
  // Only Apple's reason code is stored: never the token or the payload.
  return { outcome: classifyApnsResponse(response.status, reason), error: `${response.status} ${reason ?? ''}`.trim() }
}

// ============================================================================
// The job
// ============================================================================

export interface PushRunSummary {
  processed: number
  failed: number
  errors: string[]
  metadata: Record<string, unknown>
}

const BATCH_SIZE = 200
/** `finish_push_notifications` fails a retry after this many attempts. */
const MAX_ATTEMPTS = 5
const CONCURRENCY = 20

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }))
  return results
}

export async function sendPushNotifications(
  client: SupabaseClient,
  credentials: ApnsCredentials | null,
  options: { fetchImpl?: typeof fetch; deadlineMs?: number; signer?: ApnsTokenSigner } = {},
): Promise<PushRunSummary> {
  const summary: PushRunSummary = { processed: 0, failed: 0, errors: [], metadata: { sent: 0, unregistered: 0, retried: 0 } }
  if (!credentials) {
    summary.metadata.skipped = 'apns_not_configured'
    return summary
  }
  const signer = options.signer ?? new ApnsTokenSigner(credentials)
  const deadline = Date.now() + (options.deadlineMs ?? 40_000)
  const counts = summary.metadata as Record<string, number>

  while (Date.now() < deadline) {
    const { data, error } = await client.rpc('claim_push_notifications', { p_limit: BATCH_SIZE })
    if (error) throw error
    const pushes = (data ?? []) as ClaimedPush[]
    if (pushes.length === 0) break

    const results = await mapConcurrent(pushes, CONCURRENCY, async (push) => {
      try {
        return await sendToApns(push, signer, options.fetchImpl)
      } catch (error) {
        log.error('Push send failed', { outbox_id: push.id, error: serializeError(error) })
        return { outcome: 'retry', error: 'send failed' } as SendResult
      }
    })

    const { error: finishError } = await client.rpc('finish_push_notifications', {
      p_results: pushes.map((push, i) => ({
        id: push.id,
        lease_token: push.lease_token,
        outcome: results[i].outcome,
        error: results[i].error ?? null,
      })),
    })
    if (finishError) throw finishError

    pushes.forEach((push, i) => {
      const { outcome, error } = results[i]
      summary.processed++
      if (outcome === 'sent') counts.sent++
      else if (outcome === 'unregistered') counts.unregistered++
      else if (outcome === 'retry' && push.attempts < MAX_ATTEMPTS) counts.retried++
      else {
        // Only a push that is given up on degrades the run (and alerts ops);
        // an APNs hiccup that a retry absorbs doesn't.
        summary.failed++
        summary.errors.push(`${push.type} ${push.id}: ${error ?? outcome}`)
      }
    })

    if (pushes.length < BATCH_SIZE) break
  }
  return summary
}
