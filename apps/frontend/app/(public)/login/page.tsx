'use client'

import { useState } from 'react'
import { login, resendConfirmationEmail } from './actions'
import Link from 'next/link'
import { FormError, FormSuccess } from '../../components/FormError'
import DiscordLoginButton from '../../components/auth/DiscordLoginButton'
import GoogleLoginButton from '../../components/auth/GoogleLoginButton'
import NavLogo from '../../components/navigation/NavLogo'
import { toast } from 'sonner'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [showResendOption, setShowResendOption] = useState(false)
  const [lastEmail, setLastEmail] = useState('')
  const [resendSuccess, setResendSuccess] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setIsLoading(true)
    setShowResendOption(false)
    setResendSuccess(false)

    const email = formData.get('email') as string
    setLastEmail(email)

    try {
      const result = await login(formData)
      if (result?.error) {
        setError(result.error)
        toast.error(result.error)

        // Check if error is about unconfirmed email
        if (result.error.toLowerCase().includes('confirm')) {
          setShowResendOption(true)
        }
      }
    } catch {
      // If redirect happens, this won't execute
      // If some other error occurs, show generic message
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleResend() {
    if (!lastEmail) return

    setIsResending(true)
    setError(null)

    try {
      const result = await resendConfirmationEmail(lastEmail)
      if (result.success) {
        setResendSuccess(true)
        setShowResendOption(false)
      } else if (result.error) {
        setError(result.error)
      }
    } catch {
      setError('Failed to resend email')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <div className="w-full max-w-md space-y-8 px-4">
        {/* Back to home navigation */}
        <div className="flex justify-center">
          <NavLogo href="/" />
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold font-display text-foreground">Welcome Back</h1>
          <p className="mt-3 text-foreground-secondary">Sign in to your account</p>
        </div>

        <div className="card p-8">
          <form action={handleSubmit} className="space-y-6">
            <FormError message={error} />
            {resendSuccess && (
              <FormSuccess message="Confirmation email sent! Check your inbox." />
            )}

            {/* Show resend option when email not confirmed */}
            {showResendOption && !resendSuccess && (
              <div className="alert alert-warning">
                <p className="mb-3">Your email address hasn&apos;t been confirmed yet.</p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isResending}
                  className="text-sm font-semibold text-gold hover:text-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isResending ? 'Sending...' : 'Resend confirmation email'}
                </button>
              </div>
            )}

            <div className="space-y-4">
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
              <div>
                <label htmlFor="password" className="sr-only">
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
                  placeholder="Password"
                  data-testid="password-input"
                />
              </div>
            </div>

            <button type="submit" disabled={isLoading} className="btn btn-primary w-full py-3" data-testid="login-button">
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-foreground-muted/30" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background-elevated px-4 text-foreground-muted">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <GoogleLoginButton />
              <DiscordLoginButton />
            </div>

            <div className="text-center space-y-3">
              <p className="text-sm">
                <Link
                  href="/forgot-password"
                  className="text-foreground-muted hover:text-gold transition-colors"
                  data-testid="forgot-password-link"
                >
                  Forgot your password?
                </Link>
              </p>
              <p className="text-sm text-foreground-secondary">
                Don&apos;t have an account?{' '}
                <Link
                  href="/signup"
                  className="font-semibold text-gold hover:text-gold-hover transition-colors"
                >
                  Sign up
                </Link>
              </p>
              <p className="text-sm">
                <Link
                  href="/auth/auth-code-error"
                  className="text-foreground-muted hover:text-gold transition-colors"
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
