/**
 * Revoking Sign in with Apple when someone deletes their account, as App Review
 * guideline 5.1.1(v) asks. Revoking ends the app's access in the person's
 * Apple ID settings, so "Sign in with Apple" there stops listing Fantasy Reel.
 *
 * Apple only revokes a token it issued, and Supabase keeps none of Apple's
 * tokens, so the iPhone app asks Apple for a fresh authorization code right
 * before deletion and sends it here. Two calls to Apple follow: exchange the
 * code for a refresh token, then revoke that token. Both are signed with a
 * client secret: a short-lived ES256 JWT made from the Sign in with Apple key.
 *
 * Configured by four Edge Function secrets. Without all of them revocation is
 * off and deletion carries on without it (local development, the web app):
 *   APPLE_TEAM_ID      the Apple Developer team ID
 *   APPLE_KEY_ID       the ID of the Sign in with Apple key
 *   APPLE_PRIVATE_KEY  that key's .p8 contents (PEM, newlines kept or as \n)
 *   APPLE_CLIENT_ID    the iPhone app's bundle ID, which Apple issued the code to
 */
import { fetchWithTimeout } from './http.ts'

const APPLE_ISSUER = 'https://appleid.apple.com'
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`
const REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`
/** Apple accepts client secrets valid for up to six months; this one is used once. */
const CLIENT_SECRET_LIFETIME_SECONDS = 5 * 60
const APPLE_TIMEOUT_MS = 8_000

export interface AppleRevocationConfig {
  teamId: string
  keyId: string
  privateKey: string
  clientId: string
}

export type AppleRevocationResult = 'revoked' | 'failed'

/** The configuration from the environment, or null when any part is unset. */
export function appleRevocationConfig(env: (key: string) => string | undefined = Deno.env.get): AppleRevocationConfig | null {
  const teamId = env('APPLE_TEAM_ID')?.trim()
  const keyId = env('APPLE_KEY_ID')?.trim()
  const privateKey = env('APPLE_PRIVATE_KEY')?.trim()
  const clientId = env('APPLE_CLIENT_ID')?.trim()
  if (!teamId || !keyId || !privateKey || !clientId) return null
  return { teamId, keyId, privateKey, clientId }
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlJSON(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/** The DER bytes inside a PKCS#8 PEM, which is how Apple delivers the .p8 key. */
function pkcs8Bytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
}

/**
 * The client secret Apple's token and revoke endpoints require. WebCrypto's
 * ECDSA signature is already the raw r||s form a JWS ES256 signature uses.
 */
export async function appleClientSecret(config: AppleRevocationConfig, nowMs: number = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes(config.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const issuedAt = Math.floor(nowMs / 1000)
  const signingInput = [
    base64UrlJSON({ alg: 'ES256', kid: config.keyId }),
    base64UrlJSON({
      iss: config.teamId,
      iat: issuedAt,
      exp: issuedAt + CLIENT_SECRET_LIFETIME_SECONDS,
      aud: APPLE_ISSUER,
      sub: config.clientId,
    }),
  ].join('.')
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  )
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

/**
 * Exchanges the authorization code for a refresh token and revokes it.
 * Never throws: the caller has already deleted the account, so a failure is
 * reported as 'failed' for logging rather than undoing anything.
 */
export async function revokeAppleAuthorization(
  authorizationCode: string,
  config: AppleRevocationConfig,
  fetchImpl: typeof fetch = fetch
): Promise<AppleRevocationResult> {
  try {
    const clientSecret = await appleClientSecret(config)
    const tokenResponse = await fetchWithTimeout(
      TOKEN_URL,
      formPost({
        client_id: config.clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
      APPLE_TIMEOUT_MS,
      fetchImpl
    )
    if (!tokenResponse.ok) return 'failed'
    const tokens: { refresh_token?: unknown; access_token?: unknown } = await tokenResponse.json()
    const [token, hint] = typeof tokens.refresh_token === 'string'
      ? [tokens.refresh_token, 'refresh_token']
      : typeof tokens.access_token === 'string'
        ? [tokens.access_token, 'access_token']
        : [null, null]
    if (!token || !hint) return 'failed'

    const revokeResponse = await fetchWithTimeout(
      REVOKE_URL,
      formPost({ client_id: config.clientId, client_secret: clientSecret, token, token_type_hint: hint }),
      APPLE_TIMEOUT_MS,
      fetchImpl
    )
    return revokeResponse.ok ? 'revoked' : 'failed'
  } catch {
    return 'failed'
  }
}

function formPost(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }
}
