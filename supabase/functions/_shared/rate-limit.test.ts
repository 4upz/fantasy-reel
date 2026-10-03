import { assertEquals, assertMatch } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { consumeRateLimit, describeRetryAfter, hashSubject, rateLimitResponse } from './rate-limit.ts'
import { consumeInvitationEmailAllowance, INVITE_LIMITS, maxPendingInvitations } from './invitations.ts'

/** In-memory stand-in for the consume_rate_limit RPC. */
function fakeLimiter(options: { error?: boolean } = {}) {
  const counts = new Map<string, number>()
  const calls: Record<string, unknown>[] = []
  const client = {
    rpc: (fn: string, args: { p_bucket: string; p_subject: string; p_max: number }) => {
      calls.push({ fn, ...args })
      if (options.error) return Promise.resolve({ data: null, error: { message: 'relation does not exist' } })
      const key = `${args.p_bucket}|${args.p_subject}`
      const used = counts.get(key) ?? 0
      if (used >= args.p_max) {
        return Promise.resolve({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 7200 }], error: null })
      }
      counts.set(key, used + 1)
      return Promise.resolve({
        data: [{ allowed: true, remaining: args.p_max - used - 1, retry_after_seconds: 0 }],
        error: null,
      })
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

const limit = { bucket: 'test', subject: 'user-1', max: 2, windowSeconds: 60 }

Deno.test('consumeRateLimit allows up to max, then refuses with a retry time', async () => {
  const { client } = fakeLimiter()
  assertEquals(await consumeRateLimit(client, limit), { allowed: true, retryAfterSeconds: 0 })
  assertEquals(await consumeRateLimit(client, limit), { allowed: true, retryAfterSeconds: 0 })
  assertEquals(await consumeRateLimit(client, limit), { allowed: false, retryAfterSeconds: 7200 })
})

Deno.test('consumeRateLimit fails open when the counter cannot be read', async () => {
  const { client } = fakeLimiter({ error: true })
  assertEquals(await consumeRateLimit(client, limit), { allowed: true, retryAfterSeconds: 0 })
})

Deno.test('describeRetryAfter rounds to minutes, then hours', () => {
  assertEquals(describeRetryAfter(5), '1 minute')
  assertEquals(describeRetryAfter(600), '10 minutes')
  assertEquals(describeRetryAfter(3500), '59 minutes')
  assertEquals(describeRetryAfter(3600), 'about 1 hour')
  assertEquals(describeRetryAfter(3 * 3600 + 100), 'about 3 hours')
})

Deno.test('rateLimitResponse is a 429 with Retry-After', async () => {
  const response = rateLimitResponse('Slow down', 90)
  assertEquals(response.status, 429)
  assertEquals(response.headers.get('Retry-After'), '90')
  assertEquals(await response.json(), { error: 'Slow down', retry_after_seconds: 90 })
})

Deno.test('hashSubject is a stable hex digest that hides the input', async () => {
  const hash = await hashSubject('person@example.com')
  assertMatch(hash, /^[0-9a-f]{64}$/)
  assertEquals(hash, await hashSubject('person@example.com'))
})

const owner = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const league = 'a1b2c3d4-e5f6-7890-abcd-ef1234567891'

Deno.test('invitation emails are capped per recipient per league', async () => {
  const { client, calls } = fakeLimiter()
  const params = { ownerId: owner, leagueId: league, email: 'friend@example.com' }
  for (let i = 0; i < INVITE_LIMITS.emailsPerRecipientPerDay; i++) {
    assertEquals(await consumeInvitationEmailAllowance(client, params), null)
  }
  const refused = await consumeInvitationEmailAllowance(client, params)
  assertEquals(refused?.status, 429)
  assertMatch((await refused!.json()).error, /already been sent 3 invitation emails for this league today/)
  // The address is never stored in clear
  assertEquals(calls.some((c) => String(c.p_subject).includes('friend@example.com')), false)
  // A different league is a separate allowance
  assertEquals(await consumeInvitationEmailAllowance(client, { ...params, leagueId: owner }), null)
})

Deno.test('invitation emails are capped per owner per day', async () => {
  const { client } = fakeLimiter()
  for (let i = 0; i < INVITE_LIMITS.emailsPerOwnerPerDay; i++) {
    const params = { ownerId: owner, leagueId: league, email: `friend-${i}@example.com` }
    assertEquals(await consumeInvitationEmailAllowance(client, params), null)
  }
  const refused = await consumeInvitationEmailAllowance(client, {
    ownerId: owner, leagueId: league, email: 'one-more@example.com',
  })
  assertEquals(refused?.status, 429)
  assertMatch((await refused!.json()).error, /today's limit of 50 invitation emails\. You can send more in about 2 hours/)
})

Deno.test('a full 20-team league can be invited well within the limits', () => {
  assertEquals(maxPendingInvitations(20), 40)
  assertEquals(INVITE_LIMITS.emailsPerOwnerPerDay > 19 * 2, true)
})
