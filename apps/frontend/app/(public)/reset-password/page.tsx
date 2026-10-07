'use client'

import { useState, useEffect, useId, useRef } from 'react'
import { flushSync } from 'react-dom'
import { updatePassword, type ResetPasswordField } from './actions'
import Link from 'next/link'
import { FormError, FormSuccess, fieldErrorProps } from '../../components/FormError'
import NavLogo from '../../components/navigation/NavLogo'
import { createClient } from '@/utils/supabase/client'
import { MIN_PASSWORD_LENGTH } from '@/utils/password'
import { useHydrated } from '@/hooks/useHydrated'

export default function ResetPasswordPage() {
  // Until React attaches onSubmit, a native submit would put the fields in the URL.
  const hydrated = useHydrated()
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<ResetPasswordField | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null)
  const errorId = useId()
  const passwordHintId = useId()
  const submitRef = useRef<HTMLButtonElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const fieldRefs = { password: passwordRef, confirmPassword: confirmPasswordRef }

  useEffect(() => {
    const supabase = createClient()

    // Listen for auth state changes to handle the recovery token from URL hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Recovery token was processed, user has a valid session
        setIsValidSession(true)
      } else if (event === 'SIGNED_IN' && session) {
        // User signed in (could be from recovery)
        setIsValidSession(true)
      } else if (event === 'INITIAL_SESSION') {
        // Initial session check - if no session after this, link is invalid
        setIsValidSession(!!session)
      }
    })

    // Also check current session in case event already fired
    supabase.auth.getSession().then(({ data: { session } }) => {
      // Only set if still null (first check) - using callback form to avoid stale closure
      setIsValidSession((current) => (current === null ? !!session : current))
    })

    return () => subscription.unsubscribe()
  }, [])

  // onSubmit rather than a form action: an action clears the fields when it
  // resolves, so one mistake would make the user retype both.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)
    setErrorField(null)
    setIsLoading(true)

    let result: Awaited<ReturnType<typeof updatePassword>>
    try {
      result = await updatePassword(formData)
    } catch (err) {
      console.error('Password update failed:', err)
      result = { success: false, error: 'An unexpected error occurred' }
    }

    // The disabled form dropped focus: re-enable it (or swap in the success
    // view), then focus what the user needs next: the field an error is about
    // (it reads the error as its description) or, for any other error, the
    // button, since the error announces itself.
    flushSync(() => {
      setIsLoading(false)
      if (result.error) {
        setError(result.error)
        setErrorField(result.field ?? null)
      } else if (result.success) {
        setSuccess(true)
      }
    })

    if (result.error) {
      if (result.field) fieldRefs[result.field].current?.focus()
      else submitRef.current?.focus()
    } else if (result.success) {
      successHeadingRef.current?.focus()
    }
  }

  // Still loading session check
  if (isValidSession === null) {
    return (
      <div className="w-full max-w-md space-y-8 px-4">
        <h1 className="sr-only">Set your new password</h1>
        <div className="card p-8 text-center" role="status">
          <p className="text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  // No valid session - link may be expired or invalid
  if (!isValidSession) {
    return (
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="flex justify-center">
          <NavLogo href="/" />
        </div>
        <div className="card p-8 text-center">
          <h1 className="type-panel text-foreground mb-4">Invalid or expired link</h1>
          <p className="text-foreground-secondary mb-6">
            This password reset link is invalid or has expired. Reset links only work in the browser you requested them from. Please request a new one.
          </p>
          <Link href="/forgot-password" className="btn btn-primary">
            Request new link
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="w-full max-w-md space-y-8 text-center px-4">
        <div className="card p-8">
          {/* The message below says it visually; the heading gives focus a landing
              spot and is what's read, so the message stays quiet. */}
          <h1 ref={successHeadingRef} tabIndex={-1} className="sr-only">Password updated</h1>
          <FormSuccess message="Your password has been updated successfully!" announce={false} />
          <div className="mt-6">
            <Link href="/login" className="btn btn-primary">
              Sign in with new password
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md space-y-8 px-4">
      <div className="flex justify-center">
        <NavLogo href="/" />
      </div>
      <div className="text-center">
        <h1 className="type-page text-foreground">Set your new password</h1>
      </div>

      <div className="card p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormError message={error} id={errorId} announce={!errorField} />

          <div className="space-y-4">
            <div>
              <label htmlFor="password" className="type-label block text-foreground-secondary mb-2">
                New password
              </label>
              <input
                ref={passwordRef}
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                className="input"
                data-testid="password-input"
                {...fieldErrorProps(errorField === 'password', errorId, passwordHintId)}
              />
              <p id={passwordHintId} className="type-meta mt-1 text-foreground-secondary">
                Must be at least {MIN_PASSWORD_LENGTH} characters
              </p>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="type-label block text-foreground-secondary mb-2">
                Confirm new password
              </label>
              <input
                ref={confirmPasswordRef}
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                className="input"
                data-testid="confirm-password-input"
                {...fieldErrorProps(errorField === 'confirmPassword', errorId)}
              />
            </div>
          </div>

          <button
            ref={submitRef}
            type="submit"
            disabled={isLoading || !hydrated}
            className="btn btn-primary w-full py-3"
            data-testid="submit-button"
          >
            {isLoading ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
