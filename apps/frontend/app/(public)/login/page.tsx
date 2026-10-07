'use client'

import { Suspense, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { unstable_rethrow, useSearchParams } from 'next/navigation'
import { login, resendConfirmationEmail } from './actions'
import Link from 'next/link'
import { FormError, FormSuccess } from '../../components/FormError'
import DiscordLoginButton from '../../components/auth/DiscordLoginButton'
import GoogleLoginButton from '../../components/auth/GoogleLoginButton'
import LegalNotice from '../../components/legal/LegalNotice'
import NavLogo from '../../components/navigation/NavLogo'
import Turnstile, { CAPTCHA_PENDING_MESSAGE, useCaptcha } from '../../components/auth/Turnstile'
import { CAPTCHA_FIELD } from '@/utils/captcha'
import { useHydrated } from '@/hooks/useHydrated'

/**
 * Explains how the visitor got here from an email link. Email links only sign
 * in the browser that requested them, so one opened elsewhere lands here.
 */
function LinkNotice(): React.ReactElement | null {
  const searchParams = useSearchParams()
  if (searchParams.get('notice') === 'email_confirmed') {
    return <FormSuccess message="Your email is confirmed. Sign in to continue." />
  }
  if (searchParams.get('error') === 'link_not_signed_in') {
    return (
      <div className="alert alert-info" data-testid="link-notice">
        We couldn&apos;t finish signing you in. If you opened a confirmation email on a different
        browser or device, your email is still confirmed, so sign in below.
      </div>
    )
  }
  return null
}

export default function LoginPage() {
  // Until React attaches onSubmit, a native submit would put the fields in the URL.
  const hydrated = useHydrated()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [showResendOption, setShowResendOption] = useState(false)
  const [lastEmail, setLastEmail] = useState('')
  const [resendSuccess, setResendSuccess] = useState(false)
  const captcha = useCaptcha()
  const submitRef = useRef<HTMLButtonElement>(null)
  const resendRef = useRef<HTMLButtonElement>(null)
  const resendSuccessRef = useRef<HTMLDivElement>(null)

  // onSubmit rather than a form action: an action clears the fields when it
  // resolves, so a failed sign-in would make the user retype both.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captcha.ready) {
      setError(CAPTCHA_PENDING_MESSAGE)
      return
    }

    const formData = new FormData(event.currentTarget)
    setError(null)
    setIsLoading(true)
    setShowResendOption(false)
    setResendSuccess(false)

    const email = formData.get('email') as string
    setLastEmail(email)
    formData.set(CAPTCHA_FIELD, captcha.token ?? '')

    let message: string | null = null
    try {
      const result = await login(formData)
      message = result?.error ?? null
    } catch (err) {
      // A successful sign-in redirects, which reaches here as Next's redirect
      // signal; rethrow it for the router rather than flash an error.
      unstable_rethrow(err)
      message = 'An unexpected error occurred'
    }

    const unconfirmed = message?.toLowerCase().includes('confirm') ?? false
    // The disabled form dropped focus: re-enable it, then focus what the user
    // acts on next. The error announces itself, so focus goes to a control.
    flushSync(() => {
      setError(message)
      setShowResendOption(unconfirmed)
      setIsLoading(false)
    })
    captcha.reset()
    if (unconfirmed) resendRef.current?.focus()
    else if (message) submitRef.current?.focus()
  }

  async function handleResend() {
    if (!lastEmail) return
    if (!captcha.ready) {
      setError(CAPTCHA_PENDING_MESSAGE)
      return
    }

    setIsResending(true)
    setError(null)

    let sent = false
    let message: string | null = null
    try {
      const result = await resendConfirmationEmail(lastEmail, captcha.token ?? undefined)
      sent = result.success
      message = result.error ?? null
    } catch {
      message = 'Failed to resend email'
    }

    flushSync(() => {
      setIsResending(false)
      if (sent) {
        setResendSuccess(true)
        setShowResendOption(false)
      } else {
        setError(message)
      }
    })
    captcha.reset()
    // On success the Resend button is gone, so focus the confirmation instead
    // (it is read on focus); on failure the error announces itself.
    if (sent) resendSuccessRef.current?.focus()
    else resendRef.current?.focus()
  }

  return (
    <div className="w-full max-w-md space-y-8 px-4">
        {/* Back to home navigation */}
        <div className="flex justify-center">
          <NavLogo href="/" />
        </div>

        <div className="text-center">
          <h1 className="type-page text-foreground">Welcome back</h1>
          <p className="mt-3 text-foreground-secondary">Sign in to your account</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <Suspense fallback={null}>
              <LinkNotice />
            </Suspense>
            <FormError message={error} />
            {resendSuccess && (
              <FormSuccess message="Confirmation email sent! Check your inbox." ref={resendSuccessRef} />
            )}

            {/* Show resend option when email not confirmed */}
            {showResendOption && !resendSuccess && (
              <div className="alert alert-warning">
                <p className="mb-3">Your email address hasn&apos;t been confirmed yet.</p>
                <button
                  ref={resendRef}
                  type="button"
                  onClick={handleResend}
                  disabled={isResending}
                  className="type-control cursor-pointer text-gold hover:text-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isResending ? 'Sending...' : 'Resend confirmation email'}
                </button>
              </div>
            )}

            <div className="space-y-4">
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
              <div>
                <label htmlFor="password" className="type-label block text-foreground-secondary mb-2">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  className="input"
                  data-testid="password-input"
                />
              </div>
            </div>

            <Turnstile key={captcha.widgetKey} onToken={captcha.setToken} />

            <button
              ref={submitRef}
              type="submit"
              disabled={isLoading || !hydrated}
              className="btn btn-primary w-full py-3"
              data-testid="login-button"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-foreground-muted/30" />
              </div>
              <div className="type-body-sm relative flex justify-center">
                <span className="bg-background-elevated px-4 text-foreground-secondary">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <GoogleLoginButton />
              <DiscordLoginButton />
              {/* Either button creates an account on first use. */}
              <LegalNotice action="continuing with Google or Discord" />
            </div>

            <div className="text-center space-y-3">
              <p className="type-body-sm">
                <Link
                  href="/forgot-password"
                  className="text-foreground-secondary hover:text-gold transition-colors"
                  data-testid="forgot-password-link"
                >
                  Forgot your password?
                </Link>
              </p>
              <p className="type-body-sm text-foreground-secondary">
                Don&apos;t have an account?{' '}
                <Link
                  href="/signup"
                  className="font-semibold text-gold hover:text-gold-hover transition-colors"
                >
                  Sign up
                </Link>
              </p>
              <p className="type-body-sm">
                <Link
                  href="/auth/auth-code-error"
                  className="text-foreground-secondary hover:text-gold transition-colors"
                >
                  Didn&apos;t receive confirmation email?
                </Link>
              </p>
            </div>
          </form>
        </div>
    </div>
  )
}
