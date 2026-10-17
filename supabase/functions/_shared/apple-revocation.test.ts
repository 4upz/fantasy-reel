import { assert, assertEquals } from '@std/assert'
import {
  appleClientSecret,
  appleRevocationConfig,
  revokeAppleAuthorization,
  type AppleRevocationConfig,
} from './apple-revocation.ts'

async function testConfig(): Promise<{ config: AppleRevocationConfig; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  let binary = ''
  for (const byte of der) binary += String.fromCharCode(byte)
  const lines = btoa(binary).match(/.{1,64}/g) ?? []
  // Secrets pasted on one line keep their line breaks as literal \n.
  const privateKey = ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\\n')
  return {
    config: { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey, clientId: 'com.fantasyreel.ios' },
    publicKey: pair.publicKey,
  }
}

function decodeSegment(segment: string): Record<string, unknown> {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')))
}

function base64UrlBytes(segment: string): Uint8Array<ArrayBuffer> {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')), (c) => c.charCodeAt(0))
}

interface Call {
  url: string
  form: URLSearchParams
}

function fakeApple(responses: Record<string, Response>): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = []
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ url, form: new URLSearchParams(String(init?.body ?? '')) })
    return Promise.resolve(responses[url]?.clone() ?? new Response(null, { status: 404 }))
  }) as typeof fetch
  return { calls, fetchImpl }
}

Deno.test('appleRevocationConfig', async (t) => {
  const env = (values: Record<string, string>) => (key: string) => values[key]

  await t.step('is null unless all four secrets are set', () => {
    assertEquals(appleRevocationConfig(env({})), null)
    assertEquals(appleRevocationConfig(env({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P' })), null)
  })

  await t.step('reads and trims the secrets', () => {
    const config = appleRevocationConfig(env({
      APPLE_TEAM_ID: ' T ',
      APPLE_KEY_ID: 'K',
      APPLE_PRIVATE_KEY: 'P',
      APPLE_CLIENT_ID: 'com.fantasyreel.ios\n',
    }))
    assertEquals(config, { teamId: 'T', keyId: 'K', privateKey: 'P', clientId: 'com.fantasyreel.ios' })
  })
})

Deno.test('appleClientSecret is an ES256 JWT Apple can verify', async () => {
  const { config, publicKey } = await testConfig()
  const now = Date.UTC(2026, 9, 17, 12, 0, 0)
  const jwt = await appleClientSecret(config, now)
  const [header, payload, signature] = jwt.split('.')

  assertEquals(decodeSegment(header), { alg: 'ES256', kid: 'KEY1234567' })
  assertEquals(decodeSegment(payload), {
    iss: 'TEAM123456',
    iat: now / 1000,
    exp: now / 1000 + 300,
    aud: 'https://appleid.apple.com',
    sub: 'com.fantasyreel.ios',
  })
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64UrlBytes(signature),
    new TextEncoder().encode(`${header}.${payload}`)
  )
  assert(valid)
})

Deno.test('revokeAppleAuthorization', async (t) => {
  const { config } = await testConfig()

  await t.step('exchanges the code, then revokes the refresh token', async () => {
    const { calls, fetchImpl } = fakeApple({
      'https://appleid.apple.com/auth/token': Response.json({ access_token: 'a', refresh_token: 'r' }),
      'https://appleid.apple.com/auth/revoke': new Response(null, { status: 200 }),
    })
    assertEquals(await revokeAppleAuthorization('code-1', config, fetchImpl), 'revoked')
    assertEquals(calls.map((c) => c.url), ['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke'])
    assertEquals(calls[0].form.get('code'), 'code-1')
    assertEquals(calls[0].form.get('grant_type'), 'authorization_code')
    assertEquals(calls[0].form.get('client_id'), 'com.fantasyreel.ios')
    assertEquals(calls[1].form.get('token'), 'r')
    assertEquals(calls[1].form.get('token_type_hint'), 'refresh_token')
    assert(calls[1].form.get('client_secret')?.split('.').length === 3)
  })

  await t.step('falls back to the access token when Apple returns no refresh token', async () => {
    const { calls, fetchImpl } = fakeApple({
      'https://appleid.apple.com/auth/token': Response.json({ access_token: 'a' }),
      'https://appleid.apple.com/auth/revoke': new Response(null, { status: 200 }),
    })
    assertEquals(await revokeAppleAuthorization('code-2', config, fetchImpl), 'revoked')
    assertEquals(calls[1].form.get('token'), 'a')
    assertEquals(calls[1].form.get('token_type_hint'), 'access_token')
  })

  await t.step('reports a rejected code without calling revoke', async () => {
    const { calls, fetchImpl } = fakeApple({
      'https://appleid.apple.com/auth/token': Response.json({ error: 'invalid_grant' }, { status: 400 }),
    })
    assertEquals(await revokeAppleAuthorization('expired', config, fetchImpl), 'failed')
    assertEquals(calls.length, 1)
  })

  await t.step('reports a failed revoke and never throws', async () => {
    const failing = fakeApple({
      'https://appleid.apple.com/auth/token': Response.json({ refresh_token: 'r' }),
      'https://appleid.apple.com/auth/revoke': new Response(null, { status: 500 }),
    })
    assertEquals(await revokeAppleAuthorization('code-3', config, failing.fetchImpl), 'failed')

    const offline = (() => Promise.reject(new TypeError('network down'))) as typeof fetch
    assertEquals(await revokeAppleAuthorization('code-4', config, offline), 'failed')
  })

  await t.step('reports a malformed key as failed', async () => {
    const broken = { ...config, privateKey: 'not a key' }
    const { calls, fetchImpl } = fakeApple({})
    assertEquals(await revokeAppleAuthorization('code-5', broken, fetchImpl), 'failed')
    assertEquals(calls.length, 0)
  })
})
