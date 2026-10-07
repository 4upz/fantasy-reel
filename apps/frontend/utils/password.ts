/**
 * Password policy for every form that sets a password (sign-up, reset,
 * settings). Supabase Auth enforces the same minimum server-side
 * (`minimum_password_length` in supabase/config.toml locally, Authentication >
 * Providers > Email in production); this copy only gives a friendlier error
 * before the round trip.
 *
 * The policy applies when a password is set, never at sign-in, so accounts
 * created under the old 6-character minimum still sign in.
 */

export const MIN_PASSWORD_LENGTH = 8

export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`

export function isPasswordLongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

/**
 * Turn a Supabase Auth password error into a message for the user, or return
 * null when it isn't a password-policy error.
 *
 * - `weak_password`: too short, or (with leaked-password protection on) found
 *   in a known breach (`reasons` includes `pwned`).
 * - `reauthentication_needed`: secure password change is on and the session is
 *   older than Supabase's 24-hour window.
 */
export function passwordPolicyErrorMessage(error: {
  code?: string
  message: string
  reasons?: string[]
}): string | null {
  if (error.code === 'weak_password') {
    if (error.reasons?.includes('pwned')) {
      return 'This password has appeared in a data breach. Please choose a different one.'
    }
    return PASSWORD_TOO_SHORT_MESSAGE
  }
  if (error.code === 'reauthentication_needed') {
    return 'For your security, please sign out and sign back in, then try again.'
  }
  return null
}
