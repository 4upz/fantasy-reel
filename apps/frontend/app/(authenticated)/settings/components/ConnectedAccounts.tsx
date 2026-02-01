'use client'

import { useState } from 'react'
import { Link2, Mail, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/utils/supabase/client'
import DiscordIcon from '@/app/components/icons/DiscordIcon'
import GoogleIcon from '@/app/components/icons/GoogleIcon'
import { unlinkIdentity } from '../actions'
import type { UserIdentity } from '@supabase/supabase-js'

type OAuthProvider = 'discord' | 'google'

interface ProviderConfig {
  name: string
  scopes: string
  getDisplayInfo: (identity: UserIdentity | undefined) => string
  icon: React.ReactNode
  iconBgClass: string
  connectButtonClass: string
}

const PROVIDER_CONFIG: Record<OAuthProvider, ProviderConfig> = {
  discord: {
    name: 'Discord',
    scopes: 'identify email',
    getDisplayInfo: (identity) =>
      identity?.identity_data?.full_name ||
      identity?.identity_data?.name ||
      identity?.identity_data?.custom_claims?.global_name ||
      'Connected',
    icon: <DiscordIcon className="w-5 h-5 text-[#5865F2]" />,
    iconBgClass: 'bg-[#5865F2]/10',
    connectButtonClass: 'text-[#5865F2] hover:bg-[#5865F2]/10',
  },
  google: {
    name: 'Google',
    scopes: 'openid email profile',
    getDisplayInfo: (identity) => identity?.identity_data?.email || 'Connected',
    icon: <GoogleIcon className="w-5 h-5" />,
    iconBgClass: 'bg-white/10',
    connectButtonClass: 'text-foreground-secondary hover:bg-white/10',
  },
}

interface Props {
  email: string
  identities: UserIdentity[]
  hasPassword: boolean
}

export default function ConnectedAccounts({
  email,
  identities,
  hasPassword,
}: Props): React.ReactElement {
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null)
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProvider | null>(null)

  function getIdentity(provider: OAuthProvider): UserIdentity | undefined {
    return identities.find((i) => i.provider === provider)
  }

  async function handleLink(provider: OAuthProvider): Promise<void> {
    setLinkingProvider(provider)
    const config = PROVIDER_CONFIG[provider]

    const supabase = createClient()
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/settings&linking=true`,
        scopes: config.scopes,
      },
    })

    if (error) {
      console.error(`Link ${config.name} error:`, error)
      toast.error(`Failed to connect ${config.name}`)
      setLinkingProvider(null)
    }
  }

  async function handleUnlink(provider: OAuthProvider): Promise<void> {
    const identity = getIdentity(provider)
    if (!identity) return

    const config = PROVIDER_CONFIG[provider]

    if (!hasPassword && identities.length <= 1) {
      toast.error(`Cannot disconnect ${config.name} - it is your only sign-in method`)
      return
    }

    setUnlinkingProvider(provider)

    const result = await unlinkIdentity(identity.identity_id)

    if (result.success) {
      toast.success(`${config.name} disconnected successfully`)
    } else {
      toast.error(result.error || `Failed to disconnect ${config.name}`)
    }

    setUnlinkingProvider(null)
  }

  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
        <div className="p-2 rounded-lg bg-surface-hover">
          <Link2 className="w-5 h-5 text-foreground-secondary" />
        </div>
        <div>
          <h2 className="text-lg font-display font-semibold text-foreground">
            Connected Accounts
          </h2>
          <p className="text-sm text-foreground-muted">Manage your sign-in methods</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Email/Password */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-foreground-muted/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-foreground-secondary" />
            </div>
            <div>
              <p className="font-medium text-foreground">Email & Password</p>
              <p className="text-sm text-foreground-muted">{email}</p>
            </div>
          </div>
          {hasPassword ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Check className="w-4 h-4 text-success" />
              <span>Primary</span>
            </div>
          ) : (
            <span className="text-sm text-foreground-muted">No password set</span>
          )}
        </div>

        {/* OAuth Providers */}
        {(['discord', 'google'] as const).map((provider) => {
          const config = PROVIDER_CONFIG[provider]
          const identity = getIdentity(provider)
          const isConnected = !!identity
          const isLinking = linkingProvider === provider
          const isUnlinking = unlinkingProvider === provider

          return (
            <div key={provider} className="flex items-center justify-between p-3 rounded-lg bg-surface">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full ${config.iconBgClass} flex items-center justify-center`}>
                  {config.icon}
                </div>
                <div>
                  <p className="font-medium text-foreground">{config.name}</p>
                  <p className="text-sm text-foreground-muted">
                    {isConnected ? config.getDisplayInfo(identity) : 'Not connected'}
                  </p>
                </div>
              </div>

              {isConnected ? (
                <button
                  onClick={() => handleUnlink(provider)}
                  disabled={isUnlinking}
                  className="btn btn-ghost text-sm text-foreground-muted hover:text-error disabled:opacity-50"
                >
                  {isUnlinking ? (
                    <>
                      <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin mr-1.5" />
                      Disconnecting...
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4 mr-1" />
                      Disconnect
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => handleLink(provider)}
                  disabled={isLinking}
                  className={`btn btn-ghost text-sm ${config.connectButtonClass} disabled:opacity-50`}
                >
                  {isLinking ? (
                    <>
                      <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin mr-1.5" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
