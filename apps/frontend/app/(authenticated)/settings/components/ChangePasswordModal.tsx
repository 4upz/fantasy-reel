'use client'

import { useState, useCallback, useId } from 'react'
import { X, Lock, Eye, EyeOff } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import Modal from '@/app/components/Modal'
import Turnstile, { CAPTCHA_PENDING_MESSAGE, useCaptcha } from '@/app/components/auth/Turnstile'
import { CAPTCHA_FIELD } from '@/utils/captcha'
import { isPasswordLongEnough, MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from '@/utils/password'

interface Props {
  onClose: () => void
  onSubmit: (formData: FormData) => Promise<{ success: boolean; error?: string }>
}

interface PasswordFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder: string
  autoComplete: string
  disabled: boolean
  invalid?: boolean
  describedBy?: string
  initialFocus?: boolean
}

/** A password input with a labelled show/hide toggle that keyboards can reach. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  autoComplete,
  disabled,
  invalid = false,
  describedBy,
  initialFocus = false,
}: PasswordFieldProps): React.ReactElement {
  const [visible, setVisible] = useState(false)

  return (
    <>
      <label htmlFor={id} className="type-label block text-foreground-secondary mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={`input pr-11 ${invalid ? 'border-error focus:border-error' : ''}`}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-dialog-initial-focus={initialFocus || undefined}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={`Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-foreground-muted hover:text-foreground transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </>
  )
}

/** @design-system Modals */
export default function ChangePasswordModal({
  onClose,
  onSubmit,
}: Props): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Raised when the user leaves the confirmation or submits, never while a
  // correct confirmation is still being typed.
  const [mismatchFlagged, setMismatchFlagged] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const captcha = useCaptcha()
  const titleId = useId()
  const newPasswordHintId = useId()
  const confirmErrorId = useId()

  const passwordsDiffer = confirmPassword.length > 0 && confirmPassword !== newPassword
  const passwordsMismatch = mismatchFlagged && passwordsDiffer

  // Once the two match or the confirmation is cleared, the flag waits for the
  // next pause again, so retyping is not flagged from its first character.
  function handleNewPasswordChange(value: string): void {
    setNewPassword(value)
    if (!confirmPassword || value === confirmPassword) setMismatchFlagged(false)
  }

  function handleConfirmPasswordChange(value: string): void {
    setConfirmPassword(value)
    if (!value || value === newPassword) setMismatchFlagged(false)
  }

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
  const visibleError = clientError ?? error

  /** What blocks a submit, checked before the round trip (the server re-checks). */
  function findClientError(): string | null {
    if (!currentPassword || !newPassword || !confirmPassword) return 'All fields are required'
    if (!isPasswordLongEnough(newPassword)) return PASSWORD_TOO_SHORT_MESSAGE
    if (newPassword !== confirmPassword) return 'New passwords do not match'
    if (!captcha.ready) return CAPTCHA_PENDING_MESSAGE
    return null
  }

  // Submit stays enabled rather than dimming with no reason given; a blocked
  // submit says what is missing in the alert above the form.
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setMismatchFlagged(passwordsDiffer)
    const blocker = findClientError()
    setClientError(blocker)
    if (blocker) return

    const formData = new FormData()
    formData.append('currentPassword', currentPassword)
    formData.append('newPassword', newPassword)
    formData.append('confirmPassword', confirmPassword)
    formData.append(CAPTCHA_FIELD, captcha.token ?? '')

    try {
      const result = await execute(formData)
      if (result) onClose()
    } catch {
      // Error is handled by useAsyncAction and displayed in the UI
    } finally {
      captcha.reset()
    }
  }

  return (
    <Modal onClose={onClose} preventClose={isSubmitting} labelledBy={titleId}>
      <div className="glass card p-6 w-full max-w-md animate-slide-up motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gold-muted">
              <Lock className="w-5 h-5 text-gold" />
            </div>
            <h2 id={titleId} className="type-panel text-foreground">
              Change password
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close change password"
            className="p-1.5 rounded text-foreground-secondary hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error -- toasts are hidden behind an open dialog, so it renders here */}
        {visibleError && (
          <div role="alert" className="alert alert-error mb-4">
            <p>{visibleError}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <PasswordField
              id="currentPassword"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Enter current password"
              autoComplete="current-password"
              disabled={isSubmitting}
              initialFocus
            />
          </div>

          <div className="mb-4">
            <PasswordField
              id="newPassword"
              label="New password"
              value={newPassword}
              onChange={handleNewPasswordChange}
              placeholder="Enter new password"
              autoComplete="new-password"
              disabled={isSubmitting}
              describedBy={newPasswordHintId}
            />
            <p id={newPasswordHintId} className="type-meta mt-1 text-foreground-secondary">
              Must be at least {MIN_PASSWORD_LENGTH} characters
            </p>
          </div>

          <div className="mb-6">
            <PasswordField
              id="confirmPassword"
              label="Confirm new password"
              value={confirmPassword}
              onChange={handleConfirmPasswordChange}
              onBlur={() => setMismatchFlagged(passwordsDiffer)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              disabled={isSubmitting}
              invalid={passwordsMismatch}
              describedBy={passwordsMismatch ? confirmErrorId : undefined}
            />
            {/* Always present, so the mismatch is announced politely once
                rather than as an alert on every keystroke. */}
            <div aria-live="polite">
              {passwordsMismatch && (
                <p id={confirmErrorId} className="type-meta mt-1 text-error">Passwords do not match</p>
              )}
            </div>
          </div>

          <Turnstile key={captcha.widgetKey} onToken={captcha.setToken} className="mb-6" />

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
              disabled={isSubmitting}
              className="btn btn-primary"
            >
              {isSubmitting ? (
                <>
                  <span aria-hidden="true" className="w-4 h-4 border-2 border-foreground-inverse/30 border-t-foreground-inverse rounded-full animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
