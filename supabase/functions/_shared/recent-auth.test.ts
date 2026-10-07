import { assertEquals } from '@std/assert'
import { lastAuthenticatedAt, RECENT_SIGN_IN_WINDOW_MS, signedInRecently } from './recent-auth.ts'

function bearer(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `Bearer ${encode({ alg: 'HS256' })}.${encode(claims)}.signature`
}

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)
const secondsAgo = (s: number) => Math.floor((NOW - s * 1000) / 1000)

Deno.test('lastAuthenticatedAt', async (t) => {
  await t.step('reads the latest amr timestamp', () => {
    const header = bearer({ amr: [{ method: 'password', timestamp: secondsAgo(3600) }, { method: 'oauth', timestamp: secondsAgo(60) }] })
    assertEquals(lastAuthenticatedAt(header), secondsAgo(60) * 1000)
  })

  await t.step('is null without a usable amr claim', () => {
    assertEquals(lastAuthenticatedAt(null), null)
    assertEquals(lastAuthenticatedAt('Bearer not-a-jwt'), null)
    assertEquals(lastAuthenticatedAt(bearer({ sub: 'x' })), null)
    assertEquals(lastAuthenticatedAt(bearer({ amr: [{ method: 'password' }] })), null)
  })
})

Deno.test('signedInRecently', async (t) => {
  await t.step('accepts a sign-in inside the window', () => {
    assertEquals(signedInRecently(bearer({ amr: [{ method: 'oauth', timestamp: secondsAgo(60) }] }), NOW), true)
  })

  await t.step('rejects a session older than the window, however recently refreshed', () => {
    const stale = secondsAgo(RECENT_SIGN_IN_WINDOW_MS / 1000 + 1)
    assertEquals(signedInRecently(bearer({ iat: secondsAgo(5), amr: [{ method: 'password', timestamp: stale }] }), NOW), false)
  })

  await t.step('rejects a token with no amr claim', () => {
    assertEquals(signedInRecently(bearer({ iat: secondsAgo(5) }), NOW), false)
  })
})
