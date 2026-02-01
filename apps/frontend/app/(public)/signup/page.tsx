'use client'

import { useState } from 'react'
import { signup } from './actions'
import Link from 'next/link'
import { FormError } from '../../components/FormError'
import DiscordLoginButton from '../../components/auth/DiscordLoginButton'
import GoogleLoginButton from '../../components/auth/GoogleLoginButton'
import NavLogo from '../../components/navigation/NavLogo'
import { toast } from 'sonner'

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [email, setEmail] = useState('')

  async function handleSubmit(formData: FormData) {
    setError(null)
    setIsLoading(true)

    // Store email for the success message
    const submittedEmail = formData.get('email') as string
    setEmail(submittedEmail)

    try {
      const result = await signup(formData)
      if (result.error) {
        setError(result.error)
        toast.error(result.error)
      } else if (result.success) {
        setSignupSuccess(true)
        toast.success('Account created! Check your email to confirm.')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
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
            <h2 className="text-2xl font-bold font-display text-foreground">Check your email</h2>
            <div className="mt-6 space-y-4">
              <p className="text-foreground-secondary">
                We sent a confirmation link to <strong className="text-foreground">{email}</strong>
              </p>
              <p className="text-foreground-secondary">
                Click the link in the email to activate your account.
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
        {/* Back to home navigation */}
        <div className="flex justify-center">
          <NavLogo href="/" />
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold font-display text-foreground">Join Fantasy Reel</h1>
          <p className="mt-3 text-foreground-secondary">Create your account</p>
        </div>

        <div className="card p-8">
          <form action={handleSubmit} className="space-y-6">
            <FormError message={error} />

            <div className="space-y-4">
              <div>
                <label htmlFor="displayName" className="sr-only">
                  Display Name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  required
                  disabled={isLoading}
                  className="input"
                  placeholder="Display Name"
                />
              </div>
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
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  className="input"
                  placeholder="Password (min 6 characters)"
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="sr-only">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  className="input"
                  placeholder="Confirm Password"
                />
              </div>
            </div>

            <button type="submit" disabled={isLoading} className="btn btn-primary w-full py-3">
              {isLoading ? 'Creating account...' : 'Sign up'}
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

            <div className="text-center">
              <p className="text-sm text-foreground-secondary">
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
