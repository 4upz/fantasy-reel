import { assert, assertEquals } from '@std/assert'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ApnsTokenSigner,
  buildPayload,
  classifyApnsResponse,
  interruptionLevel,
  sendPushNotifications,
  type ApnsCredentials,
  type ClaimedPush,
} from './push-notifications.ts'

const LEAGUE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

async function testCredentials(): Promise<{ credentials: ApnsCredentials; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const body = btoa(String.fromCharCode(...pkcs8)).match(/.{1,64}/g)!.join('\n')
  return {
    credentials: { keyP8: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`, keyId: 'KEY1234567', teamId: 'TEAM123456' },
    publicKey: pair.publicKey,
  }
}

function push(overrides: Partial<ClaimedPush> = {}): ClaimedPush {
  return {
    id: crypto.randomUUID(),
    lease_token: crypto.randomUUID(),
    attempts: 1,
    notification_id: crypto.randomUUID(),
    type: 'outbid',
    title: 'You were outbid',
    body: 'Someone bid more for Dune.',
    league_id: LEAGUE,
    data: null,
    created_at: new Date().toISOString(),
    token: 'ab'.repeat(32),
    environment: 'sandbox',
    bundle_id: 'com.fantasyreel.ios',
    badge: 3,
    ...overrides,
  }
}

Deno.test('interruption levels: deadlines are time sensitive, quiet news is passive', () => {
  for (const type of ['draft_turn', 'outbid', 'trade_proposed', 'trade_countered', 'trade_review']) {
    assertEquals(interruptionLevel(type), 'time-sensitive', type)
  }
  for (const type of ['pickup_available', 'league_movie_scored']) {
    assertEquals(interruptionLevel(type), 'passive', type)
  }
  for (const type of ['bid_won', 'bid_lost', 'trade_completed', 'movie_scored', 'movie_released', 'season_started']) {
    assertEquals(interruptionLevel(type), 'active', type)
  }
})

Deno.test('payload carries the alert, badge, level and what the app routes on; passive pushes are silent', () => {
  const outbid = buildPayload(push()) as { aps: Record<string, unknown>; type: string; league_id: string }
  assertEquals(outbid.aps.alert, { title: 'You were outbid', body: 'Someone bid more for Dune.' })
  assertEquals(outbid.aps.badge, 3)
  assertEquals(outbid.aps.sound, 'default')
  assertEquals(outbid.aps['interruption-level'], 'time-sensitive')
  assertEquals(outbid.aps['thread-id'], LEAGUE)
  assertEquals([outbid.type, outbid.league_id], ['outbid', LEAGUE])

  const quiet = buildPayload(push({ type: 'league_movie_scored' })) as { aps: Record<string, unknown> }
  assertEquals(quiet.aps.sound, undefined)
  assertEquals(quiet.aps['interruption-level'], 'passive')
})

Deno.test('APNs responses map to outbox outcomes', () => {
  assertEquals(classifyApnsResponse(200, undefined), 'sent')
  assertEquals(classifyApnsResponse(410, 'Unregistered'), 'unregistered')
  assertEquals(classifyApnsResponse(400, 'BadDeviceToken'), 'unregistered')
  assertEquals(classifyApnsResponse(400, 'DeviceTokenNotForTopic'), 'unregistered')
  assertEquals(classifyApnsResponse(400, 'PayloadTooLarge'), 'failed')
  assertEquals(classifyApnsResponse(403, 'ExpiredProviderToken'), 'retry')
  assertEquals(classifyApnsResponse(429, 'TooManyRequests'), 'retry')
  assertEquals(classifyApnsResponse(503, 'ServiceUnavailable'), 'retry')
})

Deno.test('the provider token is an ES256 JWT, reused until it is 50 minutes old', async () => {
  const { credentials, publicKey } = await testCredentials()
  let now = Date.UTC(2026, 9, 18, 12)
  const signer = new ApnsTokenSigner(credentials, () => now)
  const jwt = await signer.token()
  const [header, claims, signature] = jwt.split('.')
  const decode = (part: string) => JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/')))
  assertEquals(decode(header), { alg: 'ES256', kid: 'KEY1234567' })
  assertEquals(decode(claims), { iss: 'TEAM123456', iat: now / 1000 })
  const raw = atob(signature.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - signature.length % 4) % 4))
  assert(await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey,
    Uint8Array.from(raw, (c) => c.charCodeAt(0)), new TextEncoder().encode(`${header}.${claims}`),
  ), 'signature verifies')

  now += 49 * 60_000
  assertEquals(await signer.token(), jwt)
  now += 2 * 60_000
  assert((await signer.token()) !== jwt, 'refreshed after 50 minutes')
})

function stubClient(batches: ClaimedPush[][]) {
  const finished: Array<Array<Record<string, unknown>>> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'claim_push_notifications') return Promise.resolve({ data: batches.shift() ?? [], error: null })
      finished.push(args.p_results as Array<Record<string, unknown>>)
      return Promise.resolve({ data: 1, error: null })
    },
  } as unknown as SupabaseClient
  return { client, finished }
}

Deno.test('without APNs credentials the job claims nothing', async () => {
  const { client, finished } = stubClient([[push()]])
  const summary = await sendPushNotifications(client, null)
  assertEquals(summary.processed, 0)
  assertEquals(summary.metadata.skipped, 'apns_not_configured')
  assertEquals(finished.length, 0)
})

Deno.test('a run sends, drops dead tokens, and retries without failing the run', async () => {
  const { credentials } = await testCredentials()
  const sent = push({ environment: 'production' })
  const dead = push({ token: 'cd'.repeat(32) })
  const busy = push({ token: 'ef'.repeat(32) })
  const givenUp = push({ token: '01'.repeat(32), attempts: 5 })
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    if (url.endsWith(dead.token)) return new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 })
    if (url.endsWith(busy.token) || url.endsWith(givenUp.token)) {
      return new Response(JSON.stringify({ reason: 'ServiceUnavailable' }), { status: 503 })
    }
    return new Response(null, { status: 200 })
  }) as typeof fetch

  const { client, finished } = stubClient([[sent, dead, busy, givenUp]])
  const summary = await sendPushNotifications(client, credentials, { fetchImpl })

  const urls = requests.map((r) => r.url)
  assert(urls.includes(`https://api.push.apple.com/3/device/${sent.token}`), 'production token goes to production')
  assert(urls.includes(`https://api.sandbox.push.apple.com/3/device/${dead.token}`), 'sandbox token goes to the sandbox')
  const first = requests.find((r) => r.url.endsWith(sent.token))!
  assertEquals(first.headers.get('apns-topic'), 'com.fantasyreel.ios')
  assertEquals(first.headers.get('apns-push-type'), 'alert')
  assertEquals(first.headers.get('apns-priority'), '10')
  assertEquals(first.headers.get('apns-collapse-id'), sent.notification_id)
  assert(first.headers.get('authorization')?.startsWith('bearer '))

  assertEquals(finished[0].map((r) => r.outcome), ['sent', 'unregistered', 'retry', 'retry'])
  assertEquals(finished[0][0].lease_token, sent.lease_token)
  assertEquals(summary.processed, 4)
  assertEquals(summary.failed, 1, 'only the push on its last attempt counts as failed')
  assertEquals(summary.metadata, { sent: 1, unregistered: 1, retried: 1 })
})
