'use client'

import { useState, useEffect } from 'react'
import { updatePassword } from './actions'
import Link from 'next/link'
import { FormError, FormSuccess } from '../../components/FormError'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null)

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

  async function handleSubmit(formData: FormData) {
    setError(null)
    setIsLoading(true)

    try {
      const result = await updatePassword(formData)
      if (result.error) {
        setError(result.error)
        toast.error(result.error)
      } else if (result.success) {
        setSuccess(true)
        toast.success('Password updated successfully!')
      }
    } catch (err) {
      console.error('Password update failed:', err)
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  // Still loading session check
  if (isValidSession === null) {
    return (
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="card p-8 text-center">
          <p className="text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  // No valid session - link may be expired or invalid
  if (!isValidSession) {
    return (
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold font-display text-foreground">Fantasy Reel</h1>
        </div>
        <div className="card p-8 text-center">
          <h2 className="text-2xl font-bold font-display text-foreground mb-4">Invalid or Expired Link</h2>
          <p className="text-foreground-secondary mb-6">
            This password reset link is invalid or has expired. Please request a new one.
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
          <FormSuccess message="Your password has been updated successfully!" />
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
      <div className="text-center">
        <h1 className="text-4xl font-bold font-display text-foreground">Fantasy Reel</h1>
        <p className="mt-3 text-foreground-secondary">Set your new password</p>
      </div>

      <div className="card p-8">
        <form action={handleSubmit} className="space-y-6">
          <FormError message={error} />

          <div className="space-y-4">
            <div>
              <label htmlFor="password" className="sr-only">
                New Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                className="input"
                placeholder="New password (min 6 characters)"
                data-testid="password-input"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                disabled={isLoading}
                className="input"
                placeholder="Confirm new password"
                data-testid="confirm-password-input"
              />
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn btn-primary w-full py-3" data-testid="submit-button">
            {isLoading ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
