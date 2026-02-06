'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import DiscordIcon from '@/app/components/icons/DiscordIcon'
import GoogleIcon from '@/app/components/icons/GoogleIcon'
import { FormError } from '@/app/components/FormError'
import { verifyAndMergeAccounts, keepSeparateAccount } from './actions'

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
  const { name: providerName, icon: providerIcon, bgClass: providerBgClass } = PROVIDER_DISPLAY[oauthProvider]
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLinking, setIsLinking] = useState(false)
  const [isKeepingSeparate, setIsKeepingSeparate] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLinking(true)

    try {
      const result = await verifyAndMergeAccounts(password, duplicateUserId, email, oauthProvider)

      if (result.success) {
        toast.success('Accounts linked successfully!')
        router.push('/dashboard')
      } else {
        setError(result.error || 'Failed to link accounts')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLinking(false)
    }
  }

  const handleKeepSeparate = async () => {
    setIsKeepingSeparate(true)

    try {
      const result = await keepSeparateAccount(duplicateUserId)

      if (result.success) {
        toast.success('Continuing with new account')
        router.push('/dashboard')
      } else {
        setError(result.error || 'Failed to continue')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsKeepingSeparate(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gold-muted flex items-center justify-center">
          <Link2 className="w-8 h-8 text-gold" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">
          Link Your Accounts
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
                <p className="text-sm text-foreground-muted">{providerName} account to link</p>
              </div>
            </div>
          </div>

          {/* Password input */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              Enter password for {email}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your existing account password"
                className="input pr-10"
                required
                disabled={isLinking}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground-secondary transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && <FormError message={error} />}

          <button
            type="submit"
            disabled={isLinking || !password}
            className="btn btn-primary w-full py-3"
            data-testid="merge-account-button"
          >
            {isLinking ? (
              <>
                <span className="w-4 h-4 border-2 border-foreground-inverse/30 border-t-foreground-inverse rounded-full animate-spin mr-2" />
                Linking Accounts...
              </>
            ) : (
              'Link Accounts'
            )}
          </button>
        </form>

        {/* Alternative option */}
        <div className="mt-6 pt-6 border-t border-border text-center">
          <p className="text-sm text-foreground-muted mb-3">Don&apos;t want to link accounts?</p>
          <button
            onClick={handleKeepSeparate}
            disabled={isKeepingSeparate || isLinking}
            className="btn btn-ghost text-sm text-foreground-secondary hover:text-foreground"
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
