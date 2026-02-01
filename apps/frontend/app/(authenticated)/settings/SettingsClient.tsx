'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { User, Mail, Shield } from 'lucide-react'
import type { Profile } from '@/types'
import type { UserIdentity } from '@supabase/supabase-js'
import { updateProfile, changePassword } from './actions'
import AvatarUpload from './components/AvatarUpload'
import ConnectedAccounts from './components/ConnectedAccounts'
import ChangePasswordModal from './components/ChangePasswordModal'

interface Props {
  userId: string
  profile: Profile | null
  email: string
  identities: UserIdentity[]
  hasPassword: boolean
}

const MAX_DISPLAY_NAME_LENGTH = 100

export default function SettingsClient({
  userId,
  profile,
  email,
  identities,
  hasPassword,
}: Props): React.ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [showPasswordModal, setShowPasswordModal] = useState(false)

  const charCount = displayName.length
  const isOverLimit = charCount > MAX_DISPLAY_NAME_LENGTH
  const isSubmitDisabled = isSubmitting || isOverLimit || !displayName.trim()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setIsSubmitting(true)

    const formData = new FormData()
    formData.append('display_name', displayName)

    try {
      const result = await updateProfile(formData)
      if (result.success) {
        toast.success('Profile updated successfully')
      } else {
        toast.error(result.error ?? 'Failed to update profile')
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handlePasswordChange(
    formData: FormData
  ): Promise<{ success: boolean; error?: string }> {
    const result = await changePassword(formData)
    if (result.success) {
      toast.success('Password updated successfully')
    }
    return result
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Profile Section */}
      <section className="card p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-gold-muted">
            <User className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground">
              Profile
            </h2>
            <p className="text-sm text-foreground-muted">
              Your public profile information
            </p>
          </div>
        </div>

        {/* Avatar Upload */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-foreground-secondary mb-3">
            Profile Photo
          </label>
          <AvatarUpload
            userId={userId}
            currentAvatarUrl={profile?.avatar_url ?? null}
            displayName={displayName || email}
          />
        </div>

        {/* Display Name Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="display_name"
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              Display Name
            </label>
            <input
              type="text"
              id="display_name"
              name="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your display name"
              className={`input ${isOverLimit ? 'border-error focus:border-error focus:shadow-[0_0_0_3px_var(--color-error-bg)]' : ''}`}
              maxLength={110}
            />
            <div className="flex justify-between mt-2">
              <p className="text-xs text-foreground-muted">
                This is how other players will see you
              </p>
              <span
                className={`text-xs ${isOverLimit ? 'text-error' : 'text-foreground-muted'}`}
              >
                {charCount}/{MAX_DISPLAY_NAME_LENGTH}
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="btn btn-primary"
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-foreground-inverse/30 border-t-foreground-inverse rounded-full animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </form>
      </section>

      {/* Account Section */}
      <section className="card p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-surface-hover">
            <Mail className="w-5 h-5 text-foreground-secondary" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground">
              Account
            </h2>
            <p className="text-sm text-foreground-muted">Your account details</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-2">
            Email Address
          </label>
          <div className="flex items-center gap-3 px-3 py-2.5 bg-elevated rounded-lg border border-border">
            <Mail className="w-4 h-4 text-foreground-muted" />
            <span className="text-foreground">{email}</span>
          </div>
          <p className="mt-2 text-xs text-foreground-muted">
            Contact support to change your email address
          </p>
        </div>
      </section>

      {/* Connected Accounts Section */}
      <ConnectedAccounts email={email} identities={identities} hasPassword={hasPassword} />

      {/* Security Section */}
      <section className="card p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-surface-hover">
            <Shield className="w-5 h-5 text-foreground-secondary" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground">
              Security
            </h2>
            <p className="text-sm text-foreground-muted">
              Password and authentication
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Password</p>
            <p className="text-xs text-foreground-muted mt-0.5">
              {hasPassword
                ? 'Change your account password'
                : 'No password set (signed in via OAuth)'}
            </p>
          </div>
          {hasPassword ? (
            <button
              onClick={() => setShowPasswordModal(true)}
              className="btn btn-ghost text-sm"
            >
              Change Password
            </button>
          ) : (
            <span className="text-xs text-foreground-muted">
              Use forgot password to set one
            </span>
          )}
        </div>
      </section>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <ChangePasswordModal
          onClose={() => setShowPasswordModal(false)}
          onSubmit={handlePasswordChange}
        />
      )}
    </div>
  )
}
