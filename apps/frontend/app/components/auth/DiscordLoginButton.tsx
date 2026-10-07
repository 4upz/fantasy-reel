'use client'

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { createClient } from '@/utils/supabase/client'
import DiscordIcon from '../icons/DiscordIcon'

interface Props {
  redirectTo?: string
}

export default function DiscordLoginButton({ redirectTo }: Props): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

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
      toast.error("Couldn't connect to Discord. Please try again.")
      // Disabling the button dropped focus; give it back once it is enabled again.
      flushSync(() => setIsLoading(false))
      buttonRef.current?.focus()
    }
    // If successful, user will be redirected to Discord
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleDiscordLogin}
      disabled={isLoading}
      className="btn w-full py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      data-testid="discord-login-button"
    >
      <DiscordIcon className="w-5 h-5 mr-2" />
      {isLoading ? 'Connecting...' : 'Continue with Discord'}
    </button>
  )
}
