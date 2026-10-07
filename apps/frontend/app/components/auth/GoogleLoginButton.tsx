'use client'

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { createClient } from '@/utils/supabase/client'
import GoogleIcon from '../icons/GoogleIcon'

interface Props {
  redirectTo?: string
}

export default function GoogleLoginButton({ redirectTo }: Props): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

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
      toast.error("Couldn't connect to Google. Please try again.")
      // Disabling the button dropped focus; give it back once it is enabled again.
      flushSync(() => setIsLoading(false))
      buttonRef.current?.focus()
    }
    // If successful, user will be redirected to Google
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleGoogleLogin}
      disabled={isLoading}
      // Google's light button spec: white fill with a #747775 outline, so it
      // stays distinct on the light theme's white cards. The 1px border is
      // taken out of the padding to match the Discord button's height.
      className="btn w-full py-[11px] bg-white hover:bg-gray-100 text-[#1f1f1f] border border-[#747775] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      data-testid="google-login-button"
    >
      <GoogleIcon className="w-5 h-5 mr-2" />
      {isLoading ? 'Connecting...' : 'Continue with Google'}
    </button>
  )
}
