import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
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
          // Check if another account exists with this email
          const { data: existingProfiles } = await supabase
            .from('profiles')
            .select('user_id, display_name')
            .neq('user_id', user.id)
            .limit(100)

          // We need to check auth.users for email match
          // Since we can't query auth.users directly from client, we check if profile was created
          // If no profile exists but user exists, and user is new, this might be a duplicate
          if (!profile) {
            // Check if there's an existing user with this email by looking for profiles
            // associated with users that have the same email
            // This requires checking if there are other auth users with this email

            // For now, we'll use a different approach:
            // Query using service role to check for duplicate emails
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
              display_name:
                user.user_metadata.full_name ||
                user.user_metadata.name ||
                user.user_metadata.global_name ||
                user.user_metadata.custom_claims?.global_name ||
                user.email?.split('@')[0] ||
                'User',
              avatar_url: user.user_metadata.avatar_url || null,
            })
          }
        } else if (!profile) {
          // Existing user without profile (edge case) - create profile
          await supabase.from('profiles').insert({
            user_id: user.id,
            display_name:
              user.user_metadata.full_name ||
              user.user_metadata.name ||
              user.user_metadata.global_name ||
              user.user_metadata.custom_claims?.global_name ||
              user.email?.split('@')[0] ||
              'User',
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
