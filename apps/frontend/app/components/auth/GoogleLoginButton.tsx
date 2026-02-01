'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import GoogleIcon from '../icons/GoogleIcon'

interface Props {
  redirectTo?: string
}

export default function GoogleLoginButton({ redirectTo }: Props): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false)

  const handleGoogleLogin = async () => {
    setIsLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ''}`,
        scopes: 'openid email profile',
      },
    })

    if (error) {
      console.error('Google login error:', error)
      setIsLoading(false)
    }
    // If successful, user will be redirected to Google
  }

  return (
    <button
      type="button"
      onClick={handleGoogleLogin}
      disabled={isLoading}
      className="btn w-full py-3 bg-white hover:bg-gray-100 text-gray-800 border-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      data-testid="google-login-button"
    >
      <GoogleIcon className="w-5 h-5 mr-2" />
      {isLoading ? 'Connecting...' : 'Continue with Google'}
    </button>
  )
}
