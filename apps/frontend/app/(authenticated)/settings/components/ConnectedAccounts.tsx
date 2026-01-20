'use client'

import { useState } from 'react'
import { Link2, Mail, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/utils/supabase/client'
import DiscordIcon from '@/app/components/icons/DiscordIcon'
import { unlinkIdentity } from '../actions'
import type { UserIdentity } from '@supabase/supabase-js'

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
  const [isLinking, setIsLinking] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)

  const discordIdentity = identities.find((i) => i.provider === 'discord')
  const hasDiscord = !!discordIdentity

  // Get Discord username from identity data
  const discordUsername =
    discordIdentity?.identity_data?.full_name ||
    discordIdentity?.identity_data?.name ||
    discordIdentity?.identity_data?.custom_claims?.global_name ||
    'Connected'

  const handleLinkDiscord = async () => {
    setIsLinking(true)

    const supabase = createClient()
    const { error } = await supabase.auth.linkIdentity({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/settings&linking=true`,
        scopes: 'identify email',
      },
    })

    if (error) {
      console.error('Link Discord error:', error)
      toast.error('Failed to connect Discord')
      setIsLinking(false)
    }
    // If successful, user will be redirected to Discord
  }

  const handleUnlinkDiscord = async () => {
    if (!discordIdentity) return

    // Safety check: ensure user has another way to log in
    if (!hasPassword && identities.length <= 1) {
      toast.error('Cannot disconnect Discord - it is your only sign-in method')
      return
    }

    setIsUnlinking(true)

    const result = await unlinkIdentity(discordIdentity.identity_id)

    if (result.success) {
      toast.success('Discord disconnected successfully')
    } else {
      toast.error(result.error || 'Failed to disconnect Discord')
    }

    setIsUnlinking(false)
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

        {/* Discord */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#5865F2]/10 flex items-center justify-center">
              <DiscordIcon className="w-5 h-5 text-[#5865F2]" />
            </div>
            <div>
              <p className="font-medium text-foreground">Discord</p>
              {hasDiscord ? (
                <p className="text-sm text-foreground-muted">{discordUsername}</p>
              ) : (
                <p className="text-sm text-foreground-muted">Not connected</p>
              )}
            </div>
          </div>

          {hasDiscord ? (
            <button
              onClick={handleUnlinkDiscord}
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
              onClick={handleLinkDiscord}
              disabled={isLinking}
              className="btn btn-ghost text-sm text-[#5865F2] hover:bg-[#5865F2]/10 disabled:opacity-50"
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
      </div>
    </section>
  )
}
