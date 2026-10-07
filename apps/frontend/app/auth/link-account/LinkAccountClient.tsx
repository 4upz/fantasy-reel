'use client'

import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Link2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import DiscordIcon from '@/app/components/icons/DiscordIcon'
import GoogleIcon from '@/app/components/icons/GoogleIcon'
import { FormError } from '@/app/components/FormError'
import Turnstile, { CAPTCHA_PENDING_MESSAGE, useCaptcha } from '@/app/components/auth/Turnstile'
import { verifyAndMergeAccounts, keepSeparateAccount } from './actions'
import { useHydrated } from '@/hooks/useHydrated'

type OAuthProvider = 'discord' | 'google'

const PROVIDER_DISPLAY: Record<OAuthProvider, { name: string; icon: React.ReactNode; bgClass: string }> = {
  discord: {
    name: 'Discord',
    icon: <DiscordIcon className="w-5 h-5 text-[#5865F2]" />,
    bgClass: 'bg-[#5865F2]/10',
  },
  google: {
    name: 'Google',
    icon: <GoogleIcon className="w-5 h-5" />,
    bgClass: 'bg-white/10',
  },
}

interface Props {
  email: string
  oauthProvider: OAuthProvider
  oauthUsername: string
  duplicateUserId: string
}

export default function LinkAccountClient({
  email,
  oauthProvider,
  oauthUsername,
  duplicateUserId,
}: Props): React.ReactElement {
  // Until React attaches onSubmit, a native submit would put the fields in the URL.
  const hydrated = useHydrated()
  const { name: providerName, icon: providerIcon, bgClass: providerBgClass } = PROVIDER_DISPLAY[oauthProvider]
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A failed link describes the password field, which focus returns to.
  const [errorOnPassword, setErrorOnPassword] = useState(false)
  const [isLinking, setIsLinking] = useState(false)
  const [isKeepingSeparate, setIsKeepingSeparate] = useState(false)
  const captcha = useCaptcha()
  const errorId = useId()
  const passwordRef = useRef<HTMLInputElement>(null)
  const keepSeparateRef = useRef<HTMLButtonElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!captcha.ready) {
      setError(CAPTCHA_PENDING_MESSAGE)
      setErrorOnPassword(false)
      return
    }

    setError(null)
    setErrorOnPassword(false)
    setIsLinking(true)

    let message: string | null = null
    try {
      const result = await verifyAndMergeAccounts(password, captcha.token ?? undefined)

      if (result.success) {
        toast.success('Accounts linked successfully!')
        router.push('/dashboard')
      } else {
        message = result.error || 'Failed to link accounts'
      }
    } catch {
      message = 'Something went wrong. Please try again.'
    }

    // The disabled field dropped focus: re-enable it, then return focus to
    // the password, which reads the error as its description.
    flushSync(() => {
      setIsLinking(false)
      setError(message)
      setErrorOnPassword(message !== null)
    })
    captcha.reset()
    if (message) passwordRef.current?.focus()
  }

  const handleKeepSeparate = async () => {
    setError(null)
    setErrorOnPassword(false)
    setIsKeepingSeparate(true)

    let message: string | null = null
    try {
      const result = await keepSeparateAccount(duplicateUserId)

      if (result.success) {
        toast.success('Continuing with new account')
        router.push('/dashboard')
      } else {
        message = result.error || 'Failed to continue'
      }
    } catch {
      message = 'Something went wrong. Please try again.'
    }

    // The disabled button dropped focus: re-enable it and focus it again. The
    // error announces itself.
    flushSync(() => {
      setIsKeepingSeparate(false)
      setError(message)
    })
    if (message) keepSeparateRef.current?.focus()
  }

  return (
    <div className="w-full max-w-md">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gold-muted flex items-center justify-center">
          <Link2 className="w-8 h-8 text-gold" />
        </div>
        <h1 className="type-page text-foreground">
          Link your accounts
        </h1>
        <p className="mt-3 text-foreground-secondary">
          An account with <strong className="text-foreground">{email}</strong> already exists.
          Enter your password to link {providerName} to your existing account.
        </p>
      </div>

      {/* Form */}
      <div className="card p-6 sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* OAuth account being linked */}
          <div className="p-4 rounded-lg bg-surface border border-border">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${providerBgClass} flex items-center justify-center`}>
                {providerIcon}
              </div>
              <div>
                <p className="font-medium text-foreground">{oauthUsername}</p>
                <p className="type-body-sm text-foreground-secondary">{providerName} account to link</p>
              </div>
            </div>
          </div>

          {/* Password input */}
          <div>
            <label
              htmlFor="password"
              className="type-label block text-foreground-secondary mb-2"
            >
              Enter password for {email}
            </label>
            <div className="relative">
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your existing account password"
                className="input pr-10"
                required
                disabled={isLinking}
                aria-describedby={errorOnPassword ? errorId : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1.5 text-foreground-muted hover:text-foreground-secondary transition-colors"
                aria-label="Show password"
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <FormError message={error} id={errorId} announce={!errorOnPassword} />

          <Turnstile key={captcha.widgetKey} onToken={captcha.setToken} />

          <button
            type="submit"
            disabled={isLinking || !hydrated}
            className="btn btn-primary w-full py-3"
            data-testid="merge-account-button"
          >
            {isLinking ? (
              <>
                <span className="w-4 h-4 border-2 border-foreground-inverse/30 border-t-foreground-inverse rounded-full animate-spin mr-2" />
                Linking accounts...
              </>
            ) : (
              'Link Accounts'
            )}
          </button>
        </form>

        {/* Alternative option */}
        <div className="mt-6 pt-6 border-t border-border text-center">
          <p className="type-body-sm text-foreground-secondary mb-3">Don&apos;t want to link accounts?</p>
          <button
            ref={keepSeparateRef}
            onClick={handleKeepSeparate}
            disabled={isKeepingSeparate || isLinking}
            className="type-control btn btn-ghost text-foreground-secondary hover:text-foreground"
          >
            {isKeepingSeparate ? (
              <>
                <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin mr-1.5" />
                Processing...
              </>
            ) : (
              'Keep as Separate Account'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
