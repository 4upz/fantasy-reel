import { createClient } from '@/utils/supabase/server'
import { VerifyOtpParams } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/'

  if (token_hash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({type, token: token_hash} as VerifyOtpParams);
    
    if (!error) {
      // redirect user to specified redirect URL or root of app
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  // redirect the user to an error page with some instructions
  return NextResponse.redirect(new URL('/auth/auth-code-error', request.url))
}