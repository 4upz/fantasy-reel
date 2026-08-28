'use client'

import { useState, useCallback } from 'react'
import { X, Lock, Eye, EyeOff } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'

interface Props {
  onClose: () => void
  onSubmit: (formData: FormData) => Promise<{ success: boolean; error?: string }>
}

/** @design-system Modals */
export default function ChangePasswordModal({
  onClose,
  onSubmit,
}: Props): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const isValid =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    confirmPassword === newPassword

  const submitPasswordChange = useCallback(
    async (formData: FormData) => {
      const result = await onSubmit(formData)
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to change password')
      }
      return result
    },
    [onSubmit]
  )

  const { execute, isLoading: isSubmitting, error } = useAsyncAction(submitPasswordChange)

  const isDisabled = isSubmitting || !isValid

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    const formData = new FormData()
    formData.append('currentPassword', currentPassword)
    formData.append('newPassword', newPassword)
    formData.append('confirmPassword', confirmPassword)

    try {
      await execute(formData)
      onClose()
    } catch {
      // Error is handled by useAsyncAction and displayed in the UI
    }
  }

  return (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
      <div className="glass card p-6 w-full max-w-md animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gold-muted">
              <Lock className="w-5 h-5 text-gold" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">
              Change Password
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="alert alert-error mb-4">
            <p>{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Current Password */}
          <div className="mb-4">
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input pr-10"
                placeholder="Enter current password"
                disabled={isSubmitting}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showCurrentPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="mb-4">
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              New Password
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input pr-10"
                placeholder="Enter new password"
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showNewPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">
              Must be at least 6 characters
            </p>
          </div>

          {/* Confirm New Password */}
          <div className="mb-6">
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`input pr-10 ${
                  confirmPassword && confirmPassword !== newPassword
                    ? 'border-error focus:border-error'
                    : ''
                }`}
                placeholder="Confirm new password"
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {confirmPassword && confirmPassword !== newPassword && (
              <p className="mt-1 text-xs text-error">Passwords do not match</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDisabled}
              className="btn btn-primary"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-foreground-inverse/30 border-t-foreground-inverse rounded-full animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
