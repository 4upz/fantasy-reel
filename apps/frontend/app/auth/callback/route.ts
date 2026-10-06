import { createClient } from '@/utils/supabase/server'
import { getDisplayNameFromUser, getAvatarUrlFromUser } from '@/utils/oauth'
import { NextResponse } from 'next/server'
import { safeRedirectPath } from '@/utils/redirect'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeRedirectPath(searchParams.get('next'), '/dashboard')
  const isLinking = searchParams.get('linking') === 'true'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        // If this is a linking flow from Settings, just redirect back
        if (isLinking) {
          return NextResponse.redirect(`${origin}${next}`)
        }

        // handle_new_user creates the profile when the auth user is inserted;
        // this covers accounts created before that trigger existed.
        //
        // There is no duplicate-email check here. Supabase Auth links an OAuth
        // identity with a verified email to the existing account with that
        // email, and a unique index on auth.users(email) stops a second
        // account from being created with it.
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('user_id', user.id)
          .single()

        if (!profile) {
          await supabase.from('profiles').insert({
            user_id: user.id,
            display_name: getDisplayNameFromUser(user),
            avatar_url: getAvatarUrlFromUser(user),
          })
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }

    // The code was issued but this browser can't redeem it. That is what an
    // email link opened outside the browser that requested it looks like:
    // the email is confirmed, but only the requesting browser gets a session.
    return NextResponse.redirect(`${origin}/login?error=link_not_signed_in`)
  }

  // Return to login page with error if OAuth flow fails
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
