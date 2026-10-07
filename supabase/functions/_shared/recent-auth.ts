/**
 * "Did this person sign in recently?" for actions that should not be possible
 * from a session left open on someone else's computer.
 *
 * Supabase access tokens carry an `amr` claim: one `{ method, timestamp }`
 * entry per way the session was authenticated (password, oauth, otp, ...),
 * with the time in Unix seconds. Refreshing the token keeps those times, so
 * they measure when the person last proved who they are, not when the token
 * was minted. That works the same for password, Google and Discord accounts,
 * where re-entering a password would not.
 *
 * Only call this after the token has been verified (authenticateRequest);
 * it decodes the payload without checking the signature.
 */

export const RECENT_SIGN_IN_WINDOW_MS = 15 * 60 * 1000

/** Latest `amr` timestamp in the bearer token, in ms, or null if there is none. */
export function lastAuthenticatedAt(authorization: string | null): number | null {
  const token = authorization?.replace(/^Bearer\s+/i, '')
  const payload = token?.split('.')[1]
  if (!payload) return null

  let claims: { amr?: unknown }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    claims = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')))
  } catch {
    return null
  }

  if (!Array.isArray(claims.amr)) return null
  const times = claims.amr
    .map((entry) => (entry as { timestamp?: unknown })?.timestamp)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
  return times.length > 0 ? Math.max(...times) * 1000 : null
}

export function signedInRecently(authorization: string | null, now: number = Date.now()): boolean {
  const at = lastAuthenticatedAt(authorization)
  // A sign-in "in the future" is clock skew of a few seconds at most; allow it.
  return at !== null && now - at <= RECENT_SIGN_IN_WINDOW_MS
}
