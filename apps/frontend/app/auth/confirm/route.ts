import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/** Supabase Auth prefixes tokens it issued to a PKCE flow with this. */
const PKCE_TOKEN_PREFIX = 'pkce_'

const LINK_TYPES = new Set(['signup', 'email', 'invite', 'magiclink', 'recovery', 'email_change'])

/**
 * Email links of the form /auth/confirm?token_hash=…&type=….
 *
 * This route must never sign in the browser that opens the link by itself.
 * Verifying the token here with `verifyOtp` would do exactly that, so anyone
 * could mail their own link to someone else and sign that person into the
 * sender's account (login CSRF).
 *
 * PKCE tokens instead go through Supabase's verify endpoint, which confirms
 * the address and hands back a one-time code. Only the browser holding that
 * flow's code verifier cookie (the one that signed up or asked for the
 * reset) can exchange the code, in /auth/callback or on /reset-password.
 * Both targets are the redirect URLs the app already sends with each email,
 * so Supabase's redirect allowlist accepts them.
 *
 * Tokens from outside the app's PKCE flows (e.g. a confirmation resent from
 * the Supabase dashboard) are bound to nothing, so a sign-up confirmation is
 * accepted without starting a session, and any other kind is refused.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  if (!tokenHash || !type || !LINK_TYPES.has(type)) {
    return NextResponse.redirect(new URL('/auth/auth-code-error', origin))
  }

  if (tokenHash.startsWith(PKCE_TOKEN_PREFIX)) {
    const verifyUrl = new URL('/auth/v1/verify', process.env.NEXT_PUBLIC_SUPABASE_URL!)
    verifyUrl.searchParams.set('token', tokenHash)
    // `email` is a POST-only alias; links built from the sign-up template use it.
    verifyUrl.searchParams.set('type', type === 'email' ? 'signup' : type)
    verifyUrl.searchParams.set(
      'redirect_to',
      `${origin}${type === 'recovery' ? '/reset-password' : '/auth/callback'}`
    )
    return NextResponse.redirect(verifyUrl)
  }

  if (type === 'signup' || type === 'email') {
    // Confirms the address only: the session it returns stays in this
    // throwaway client and never reaches the browser.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    )
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(new URL('/login?notice=email_confirmed', origin))
    }
  }

  return NextResponse.redirect(new URL('/auth/auth-code-error', origin))
}
