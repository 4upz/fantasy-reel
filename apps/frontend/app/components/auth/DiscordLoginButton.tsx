'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import DiscordIcon from '../icons/DiscordIcon'

interface Props {
  redirectTo?: string
}

export default function DiscordLoginButton({ redirectTo }: Props): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false)

  const handleDiscordLogin = async () => {
    setIsLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ''}`,
        scopes: 'identify email',
      },
    })

    if (error) {
      console.error('Discord login error:', error)
      setIsLoading(false)
    }
    // If successful, user will be redirected to Discord
  }

  return (
    <button
      type="button"
      onClick={handleDiscordLogin}
      disabled={isLoading}
      className="btn w-full py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <DiscordIcon className="w-5 h-5 mr-2" />
      {isLoading ? 'Connecting...' : 'Continue with Discord'}
    </button>
  )
}
