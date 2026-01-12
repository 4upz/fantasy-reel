'use client'

import { useState } from 'react'
import Link from 'next/link'
import { resendConfirmationEmail } from '@/app/(public)/login/actions'
import { FormError, FormSuccess } from '@/app/components/FormError'

export default function AuthCodeErrorPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleResend(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const result = await resendConfirmationEmail(email)
      if (result.success) {
        setSuccess(true)
      } else if (result.error) {
        setError(result.error)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold font-display text-foreground">Authentication Error</h1>
          <p className="mt-3 text-foreground-secondary">
            The confirmation link may have expired or already been used.
          </p>
        </div>

        {/* Resend confirmation section */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Resend confirmation email</h3>

          <FormError message={error} />
          {success && (
            <FormSuccess message="If an account exists with this email, a new confirmation link has been sent." />
          )}

          {!success && (
            <form onSubmit={handleResend} className="space-y-4">
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="input"
                  placeholder="Email address"
                />
              </div>

              <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
                {isLoading ? 'Sending...' : 'Resend confirmation email'}
              </button>
            </form>
          )}

          {/* Local development helper */}
          <div className="alert alert-info mt-4">
            <p className="text-xs">
              <strong>Local development?</strong> Check Mailpit at{' '}
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
        </div>

        <div className="text-center">
          <Link href="/login" className="font-medium text-gold hover:text-gold-hover transition-colors">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
