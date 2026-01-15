import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Check if profile exists, create if not (for OAuth users)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // Create profile from OAuth provider data
          await supabase.from('profiles').insert({
            id: user.id,
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
