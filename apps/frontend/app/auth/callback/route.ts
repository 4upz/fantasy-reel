import { createClient } from '@/utils/supabase/server'
import { getDisplayNameFromUser, getAvatarUrlFromUser } from '@/utils/oauth'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * Validate redirect path to prevent open redirect attacks.
 * Only allows relative paths starting with / but not // (protocol-relative URLs).
 */
function isValidRedirectPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next = isValidRedirectPath(rawNext) ? rawNext : '/dashboard'
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

        // Check if this user was just created (OAuth signup)
        const createdAt = new Date(user.created_at)
        const now = new Date()
        const isNewUser = now.getTime() - createdAt.getTime() < 60000 // Created within last minute

        // Check if profile exists for this user
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('user_id', user.id)
          .single()

        if (isNewUser && user.email) {
          if (!profile) {
            // Check if there's an existing user with this email.
            // SECURITY DEFINER over auth.users, self-scoped: it counts rows
            // matching the *caller's* email, so it takes no argument and
            // cannot be used to probe anyone else's address.
            const { count } = await supabase.rpc(
              'count_duplicate_accounts_for_current_user'
            )

            if (count && count > 1) {
              // Duplicate detected! Store context and redirect to link-account page
              const oauthIdentity = user.identities?.find(
                (i) => i.provider === 'discord' || i.provider === 'google'
              )
              const oauthUsername =
                user.user_metadata.global_name || // Discord
                user.user_metadata.full_name || // Google
                user.user_metadata.name ||
                'OAuth User'

              // Store duplicate context in a cookie
              const cookieStore = await cookies()
              cookieStore.set(
                'link_account_context',
                JSON.stringify({
                  duplicateUserId: user.id,
                  email: user.email,
                  oauthProvider: oauthIdentity?.provider,
                  oauthUsername,
                  oauthIdentityId: oauthIdentity?.identity_id,
                }),
                {
                  httpOnly: true,
                  secure: process.env.NODE_ENV === 'production',
                  sameSite: 'lax',
                  maxAge: 600, // 10 minutes
                  path: '/',
                }
              )

              return NextResponse.redirect(`${origin}/auth/link-account`)
            }

            // No duplicate - create profile for new OAuth user
            await supabase.from('profiles').insert({
              user_id: user.id,
              display_name: getDisplayNameFromUser(user),
              avatar_url: getAvatarUrlFromUser(user),
            })
          }
        } else if (!profile) {
          // Existing user without profile (edge case) - create profile
          await supabase.from('profiles').insert({
            user_id: user.id,
            display_name: getDisplayNameFromUser(user),
            avatar_url: getAvatarUrlFromUser(user),
          })
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return to login page with error if OAuth flow fails
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
