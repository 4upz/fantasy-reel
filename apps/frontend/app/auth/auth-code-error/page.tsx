'use client'

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { resendConfirmationEmail } from '@/app/(public)/login/actions'
import { FormError, FormSuccess } from '@/app/components/FormError'
import Turnstile, { CAPTCHA_PENDING_MESSAGE, useCaptcha } from '@/app/components/auth/Turnstile'
import { useHydrated } from '@/hooks/useHydrated'

export default function AuthCodeErrorPage() {
  // Until React attaches onSubmit, a native submit would put the fields in the URL.
  const hydrated = useHydrated()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const captcha = useCaptcha()
  const submitRef = useRef<HTMLButtonElement>(null)
  const successRef = useRef<HTMLDivElement>(null)

  async function handleResend(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }
    if (!captcha.ready) {
      setError(CAPTCHA_PENDING_MESSAGE)
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(false)

    let sent = false
    let message: string | null = null
    try {
      const result = await resendConfirmationEmail(email, captcha.token ?? undefined)
      sent = result.success
      message = result.error ?? null
    } catch {
      message = 'Something went wrong. Please try again.'
    }

    // The disabled form dropped focus, and on success the form is gone:
    // re-render, then focus the confirmation (read on focus), or the button
    // again after an error, which announces itself.
    flushSync(() => {
      setIsLoading(false)
      if (sent) setSuccess(true)
      else setError(message)
    })
    captcha.reset()
    if (sent) successRef.current?.focus()
    else if (message) submitRef.current?.focus()
  }

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="type-page text-foreground">Authentication error</h1>
          <p className="mt-3 text-foreground-secondary">
            The confirmation link may have expired or already been used.
          </p>
        </div>

        {/* Resend confirmation section */}
        <div className="card p-6">
          <h2 className="type-panel text-foreground mb-4">Resend confirmation email</h2>

          <FormError message={error} />
          {success && (
            <FormSuccess
              message="If an account exists with this email, a new confirmation link has been sent."
              ref={successRef}
            />
          )}

          {!success && (
            <form onSubmit={handleResend} className="space-y-4">
              <div>
                <label htmlFor="email" className="type-label block text-foreground-secondary mb-2">
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
                />
              </div>

              <Turnstile key={captcha.widgetKey} onToken={captcha.setToken} />

              <button ref={submitRef} type="submit" disabled={isLoading || !hydrated} className="btn btn-primary w-full">
                {isLoading ? 'Sending...' : 'Resend confirmation email'}
              </button>
            </form>
          )}

          {/* Local development helper */}
          {process.env.NODE_ENV === 'development' && (
            <div className="alert alert-info mt-4">
              <p className="type-meta">
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
          )}
        </div>

        <div className="text-center">
          <Link href="/login" className="font-medium text-gold hover:text-gold-hover transition-colors">
            Back to login
          </Link>
        </div>
      </div>
    </main>
  )
}
