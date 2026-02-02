'use client'

import { useState } from 'react'
import { requestPasswordReset } from './actions'
import Link from 'next/link'
import { FormError } from '../../components/FormError'

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setIsLoading(true)

    try {
      const result = await requestPasswordReset(formData)
      if (result.error) {
        setError(result.error)
      } else if (result.success) {
        setSuccess(true)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-md space-y-8 text-center px-4">
        <div className="card p-8">
          <h2 className="text-2xl font-bold font-display text-foreground">Check your email</h2>
          <div className="mt-6 space-y-4">
            <p className="text-foreground-secondary">
              If an account exists with that email, we sent a password reset link.
            </p>
            <p className="text-foreground-secondary">
              Click the link in the email to reset your password.
            </p>
            {process.env.NODE_ENV === 'development' && (
              <div className="alert alert-info mt-6">
                <p className="text-sm">
                  <strong>Using local Supabase?</strong>
                  <br />
                  Check Mailpit at{' '}
                  <a
                    href="http://localhost:54324"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-info"
                  >
                    http://localhost:54324
                  </a>
                </p>
              </div>
            )}
            <div className="mt-6">
              <Link href="/login" className="text-gold hover:text-gold-hover font-semibold transition-colors">
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md space-y-8 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold font-display text-foreground">Fantasy Reel</h1>
        <p className="mt-3 text-foreground-secondary">Reset your password</p>
      </div>

      <div className="card p-8">
        <form action={handleSubmit} className="space-y-6">
          <FormError message={error} />

          <p className="text-sm text-foreground-secondary">
            Enter your email address and we will send you a link to reset your password.
          </p>

          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isLoading}
              className="input"
              placeholder="Email address"
              data-testid="email-input"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary w-full py-3"
            data-testid="reset-button"
          >
            {isLoading ? 'Sending...' : 'Send reset link'}
          </button>

          <div className="text-center">
            <Link
              href="/login"
              className="text-sm text-foreground-secondary hover:text-gold transition-colors"
              data-testid="back-to-login-link"
            >
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
