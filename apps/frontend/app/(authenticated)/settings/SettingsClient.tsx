'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { User, Mail, Shield, Sun, Trash2 } from 'lucide-react'
import ThemeSelector from '@/components/theme/ThemeSelector'
import type { Profile } from '@/types'
import type { UserIdentity } from '@supabase/supabase-js'
import { updateProfile, changePassword } from './actions'
import AvatarUpload from './components/AvatarUpload'
import ConnectedAccounts from './components/ConnectedAccounts'
import ChangePasswordModal from './components/ChangePasswordModal'
import DeleteAccountModal from './components/DeleteAccountModal'
import EmailPreferences from './components/EmailPreferences'

interface Props {
  userId: string
  profile: Profile | null
  email: string
  identities: UserIdentity[]
  hasPassword: boolean
  seasonRecapEmails: boolean
}

const MAX_DISPLAY_NAME_LENGTH = 100

export default function SettingsClient({
  userId,
  profile,
  email,
  identities,
  hasPassword,
  seasonRecapEmails,
}: Props): React.ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const charCount = displayName.length
  const isOverLimit = charCount > MAX_DISPLAY_NAME_LENGTH

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
      <section className="card p-6" aria-labelledby="appearance-heading">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-gold-muted">
            <Sun className="w-5 h-5 text-gold" aria-hidden="true" />
          </div>
          <div>
            <h2 id="appearance-heading" className="type-section text-foreground">Appearance</h2>
            <p className="type-body-sm text-foreground-secondary">
              Choose a theme, or follow your device with System. Saved on this device.
            </p>
          </div>
        </div>
        <div className="max-w-sm">
          <ThemeSelector />
        </div>
      </section>

      {/* Profile Section */}
      <section className="card p-6" aria-labelledby="profile-heading">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-gold-muted">
            <User className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h2 id="profile-heading" className="type-section text-foreground">
              Profile
            </h2>
            <p className="type-body-sm text-foreground-secondary">
              Your public profile information
            </p>
          </div>
        </div>

        {/* Avatar Upload */}
        <div className="mb-8" role="group" aria-labelledby="profile-photo-heading">
          <h3 id="profile-photo-heading" className="type-label block text-foreground-secondary mb-3">
            Profile photo
          </h3>
          <AvatarUpload
            userId={userId}
            currentAvatarUrl={profile?.avatar_url ?? null}
            displayName={displayName || email}
          />
        </div>

        {/* Display name Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="display_name"
              className="type-label block text-foreground-secondary mb-2"
            >
              Display name
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
              required
              aria-invalid={isOverLimit || undefined}
              aria-describedby={`display_name-help display_name-count${isOverLimit ? ' display_name-error' : ''}`}
            />
            <div className="flex justify-between mt-2">
              <p id="display_name-help" className="type-meta text-foreground-secondary">
                This is how other players will see you
              </p>
              <span
                id="display_name-count"
                className={`type-meta ${isOverLimit ? 'text-error' : 'text-foreground-secondary'}`}
              >
                {charCount}
                <span className="sr-only"> of </span>
                <span aria-hidden="true">/</span>
                {MAX_DISPLAY_NAME_LENGTH}
                <span className="sr-only"> characters</span>
              </span>
            </div>
            {isOverLimit && (
              <p id="display_name-error" role="alert" className="type-meta text-error mt-1">
                Display names can be at most {MAX_DISPLAY_NAME_LENGTH} characters.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
          >
            {isSubmitting ? (
              <>
                <span aria-hidden="true" className="w-4 h-4 border-2 border-foreground-inverse/30 border-t-foreground-inverse rounded-full animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </form>
      </section>

      {/* Account Section */}
      <section className="card p-6" aria-labelledby="account-heading">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-surface-hover">
            <Mail className="w-5 h-5 text-foreground-secondary" />
          </div>
          <div>
            <h2 id="account-heading" className="type-section text-foreground">
              Account
            </h2>
            <p className="type-body-sm text-foreground-secondary">Your account details</p>
          </div>
        </div>

        <dl>
          <dt className="type-label block text-foreground-secondary mb-2">
            Email address
          </dt>
          <dd className="flex items-center gap-3 px-3 py-2.5 bg-elevated rounded-lg border border-border">
            <Mail className="w-4 h-4 text-foreground-muted" />
            <span className="text-foreground break-all">{email}</span>
          </dd>
        </dl>
        <p className="type-meta mt-2 text-foreground-secondary">
          Contact support to change your email address
        </p>
      </section>

      <EmailPreferences seasonRecapEmails={seasonRecapEmails} />

      {/* Connected accounts Section */}
      <ConnectedAccounts email={email} identities={identities} hasPassword={hasPassword} />

      {/* Security Section */}
      <section className="card p-6" aria-labelledby="security-heading">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-surface-hover">
            <Shield className="w-5 h-5 text-foreground-secondary" />
          </div>
          <div>
            <h2 id="security-heading" className="type-section text-foreground">
              Security
            </h2>
            <p className="type-body-sm text-foreground-secondary">
              Password and authentication
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="type-label text-foreground">Password</p>
            <p className="type-meta text-foreground-secondary mt-0.5">
              {hasPassword
                ? 'Change your account password'
                : 'No password set (signed in via OAuth)'}
            </p>
          </div>
          {hasPassword ? (
            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="type-control btn btn-ghost"
            >
              Change password
            </button>
          ) : (
            <span className="type-meta text-foreground-secondary">
              Use forgot password to set one
            </span>
          )}
        </div>
      </section>

      {/* Delete account Section */}
      <section className="card p-6" aria-labelledby="delete-account-section-heading">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="p-2 rounded-lg bg-error-bg">
            <Trash2 className="w-5 h-5 text-crimson" aria-hidden="true" />
          </div>
          <div>
            <h2 id="delete-account-section-heading" className="type-section text-foreground">
              Delete account
            </h2>
            <p className="type-body-sm text-foreground-secondary">
              Permanently remove your account and personal data
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="type-meta text-foreground-secondary">
            Leagues you run pass to another member. This can&apos;t be undone.
          </p>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="type-control btn btn-danger shrink-0"
            data-testid="delete-account-button"
          >
            Delete account
          </button>
        </div>
      </section>

      {showDeleteModal && <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />}

      {/* Change password Modal */}
      {showPasswordModal && (
        <ChangePasswordModal
          onClose={() => setShowPasswordModal(false)}
          onSubmit={handlePasswordChange}
        />
      )}
    </div>
  )
}
