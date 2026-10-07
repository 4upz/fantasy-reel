'use client'

import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { signup, type SignupField } from './actions'
import Link from 'next/link'
import { FormError, fieldErrorProps } from '../../components/FormError'
import DiscordLoginButton from '../../components/auth/DiscordLoginButton'
import GoogleLoginButton from '../../components/auth/GoogleLoginButton'
import LegalNotice from '../../components/legal/LegalNotice'
import NavLogo from '../../components/navigation/NavLogo'
import Turnstile, { CAPTCHA_PENDING_MESSAGE, useCaptcha } from '../../components/auth/Turnstile'
import { CAPTCHA_FIELD } from '@/utils/captcha'
import { MIN_PASSWORD_LENGTH } from '@/utils/password'
import { toast } from 'sonner'
import { useHydrated } from '@/hooks/useHydrated'

export default function SignupPage() {
  // Until React attaches onSubmit, a native submit would put the fields in the URL.
  const hydrated = useHydrated()
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<SignupField | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [email, setEmail] = useState('')
  const captcha = useCaptcha()
  const errorId = useId()
  const passwordHintId = useId()
  const submitRef = useRef<HTMLButtonElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const fieldRefs = { email: emailRef, password: passwordRef, confirmPassword: confirmPasswordRef }

  // onSubmit rather than a form action: an action clears the fields when it
  // resolves, so one mistake would make the user retype everything.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captcha.ready) {
      setError(CAPTCHA_PENDING_MESSAGE)
      setErrorField(null)
      return
    }

    const formData = new FormData(event.currentTarget)
    setError(null)
    setErrorField(null)
    setIsLoading(true)

    // Store email for the success message
    setEmail(formData.get('email') as string)
    formData.set(CAPTCHA_FIELD, captcha.token ?? '')

    let result: Awaited<ReturnType<typeof signup>>
    try {
      result = await signup(formData)
    } catch {
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
        setSignupSuccess(true)
      }
    })
    captcha.reset()

    if (result.error) {
      if (result.field) fieldRefs[result.field].current?.focus()
      else submitRef.current?.focus()
    } else if (result.success) {
      toast.success('Account created! Check your email to confirm.')
      successHeadingRef.current?.focus()
    }
  }

  // Show success message after signup
  if (signupSuccess) {
    return (
      <div className="w-full max-w-md space-y-8 text-center px-4">
          {/* Back to home navigation */}
          <div className="flex justify-center">
            <NavLogo href="/" />
          </div>

          <div className="card p-8">
            <h1 ref={successHeadingRef} tabIndex={-1} className="type-panel text-foreground focus:outline-none">
              Check your email
            </h1>
            <div className="mt-6 space-y-4">
              <p className="text-foreground-secondary">
                We sent a confirmation link to <strong className="text-foreground">{email}</strong>
              </p>
              <p className="text-foreground-secondary">
                Click the link in the email to activate your account.
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
        {/* Back to home navigation */}
        <div className="flex justify-center">
          <NavLogo href="/" />
        </div>

        <div className="text-center">
          <h1 className="type-page text-foreground">Join Fantasy Reel</h1>
          <p className="mt-3 text-foreground-secondary">Create your account</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <FormError message={error} id={errorId} announce={!errorField} />

            <div className="space-y-4">
              <div>
                <label htmlFor="displayName" className="type-label block text-foreground-secondary mb-2">
                  Display name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="nickname"
                  required
                  disabled={isLoading}
                  className="input"
                  data-testid="display-name-input"
                />
              </div>
              <div>
                <label htmlFor="email" className="type-label block text-foreground-secondary mb-2">
                  Email address
                </label>
                <input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  className="input"
                  data-testid="email-input"
                  {...fieldErrorProps(errorField === 'email', errorId)}
                />
              </div>
              <div>
                <label htmlFor="password" className="type-label block text-foreground-secondary mb-2">
                  Password
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
                  Confirm password
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
                  {...fieldErrorProps(errorField === 'confirmPassword', errorId)}
                />
              </div>
            </div>

            <Turnstile key={captcha.widgetKey} onToken={captcha.setToken} />

            <div className="space-y-3">
              <button
                ref={submitRef}
                type="submit"
                disabled={isLoading || !hydrated}
                className="btn btn-primary w-full py-3"
                data-testid="signup-button"
              >
                {isLoading ? 'Creating account...' : 'Sign up'}
              </button>
              <LegalNotice action="creating an account" />
            </div>

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
            </div>

            <div className="text-center">
              <p className="type-body-sm text-foreground-secondary">
                Already have an account?{' '}
                <Link
                  href="/login"
                  className="font-semibold text-gold hover:text-gold-hover transition-colors"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </form>
        </div>
    </div>
  )
}
