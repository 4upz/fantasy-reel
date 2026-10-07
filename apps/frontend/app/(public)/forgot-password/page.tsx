'use client'

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { requestPasswordReset } from './actions'
import Link from 'next/link'
import { FormError } from '../../components/FormError'
import NavLogo from '../../components/navigation/NavLogo'
import Turnstile, { CAPTCHA_PENDING_MESSAGE, useCaptcha } from '../../components/auth/Turnstile'
import { CAPTCHA_FIELD } from '@/utils/captcha'
import { useHydrated } from '@/hooks/useHydrated'

export default function ForgotPasswordPage() {
  // Until React attaches onSubmit, a native submit would put the fields in the URL.
  const hydrated = useHydrated()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const captcha = useCaptcha()
  const submitRef = useRef<HTMLButtonElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)

  // onSubmit rather than a form action: an action clears the field when it
  // resolves, so a failed request would make the user retype the address.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captcha.ready) {
      setError(CAPTCHA_PENDING_MESSAGE)
      return
    }

    const formData = new FormData(event.currentTarget)
    setError(null)
    setIsLoading(true)
    formData.set(CAPTCHA_FIELD, captcha.token ?? '')

    let result: Awaited<ReturnType<typeof requestPasswordReset>>
    try {
      result = await requestPasswordReset(formData)
    } catch {
      result = { success: false, error: 'An unexpected error occurred' }
    }

    // The disabled form dropped focus: re-enable it (or swap in the success
    // view), then focus what the user needs next. The error announces itself,
    // so focus goes back to the button.
    flushSync(() => {
      setIsLoading(false)
      if (result.error) setError(result.error)
      else if (result.success) setSuccess(true)
    })
    captcha.reset()

    if (result.error) submitRef.current?.focus()
    else if (result.success) successHeadingRef.current?.focus()
  }

  if (success) {
    return (
      <div className="w-full max-w-md space-y-8 text-center px-4">
        <div className="card p-8">
          <h1 ref={successHeadingRef} tabIndex={-1} className="type-panel text-foreground focus:outline-none">
            Check your email
          </h1>
          <div className="mt-6 space-y-4">
            <p className="text-foreground-secondary">
              If an account exists with that email, we sent a password reset link.
            </p>
            <p className="text-foreground-secondary">
              Click the link in the email to reset your password.
            </p>
            {process.env.NODE_ENV === 'development' && (
              <div className="alert alert-info mt-6">
                <p className="type-body-sm">
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
      <div className="flex justify-center">
        <NavLogo href="/" />
      </div>
      <div className="text-center">
        <h1 className="type-page text-foreground">Reset your password</h1>
      </div>

      <div className="card p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormError message={error} />

          <p className="type-body-sm text-foreground-secondary">
            Enter your email address and we will send you a link to reset your password.
          </p>

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
              disabled={isLoading}
              className="input"
              data-testid="email-input"
            />
          </div>

          <Turnstile key={captcha.widgetKey} onToken={captcha.setToken} />

          <button
            ref={submitRef}
            type="submit"
            disabled={isLoading || !hydrated}
            className="btn btn-primary w-full py-3"
            data-testid="reset-button"
          >
            {isLoading ? 'Sending...' : 'Send reset link'}
          </button>

          <div className="text-center">
            <Link
              href="/login"
              className="type-control text-foreground-secondary hover:text-gold transition-colors"
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
