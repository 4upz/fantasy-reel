import type { User } from '@supabase/supabase-js'

import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * Validate redirect path to prevent open redirect attacks.
 * Only allows relative paths starting with / but not // (protocol-relative URLs).
 */
function isValidRedirectPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

/**
 * Extract display name from user metadata, with fallbacks.
 */
function getDisplayName(user: User): string {
  return (
    user.user_metadata.full_name ||
    user.user_metadata.name ||
    user.user_metadata.global_name ||
    user.user_metadata.custom_claims?.global_name ||
    user.email?.split('@')[0] ||
    'User'
  )
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
            // Check if there's an existing user with this email
            // Uses a SECURITY DEFINER function to query auth.users
            const { count } = await supabase.rpc('count_users_by_email', {
              email_to_check: user.email,
            })

            if (count && count > 1) {
              // Duplicate detected! Store context and redirect to link-account page
              const discordIdentity = user.identities?.find((i) => i.provider === 'discord')
              const discordUsername =
                user.user_metadata.global_name ||
                user.user_metadata.full_name ||
                user.user_metadata.name ||
                'Discord User'

              // Store duplicate context in a cookie
              const cookieStore = await cookies()
              cookieStore.set(
                'link_account_context',
                JSON.stringify({
                  duplicateUserId: user.id,
                  email: user.email,
                  discordUsername,
                  discordIdentityId: discordIdentity?.identity_id,
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
              display_name: getDisplayName(user),
              avatar_url: user.user_metadata.avatar_url || null,
            })
          }
        } else if (!profile) {
          // Existing user without profile (edge case) - create profile
          await supabase.from('profiles').insert({
            user_id: user.id,
            display_name: getDisplayName(user),
            avatar_url: user.user_metadata.avatar_url || null,
          })
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return to login page with error if OAuth flow fails
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
