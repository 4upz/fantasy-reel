'use client'

import { useState } from 'react'
import { login, resendConfirmationEmail } from './actions'
import Link from 'next/link'
import { FormError, FormSuccess } from '../components/FormError'
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Fantasy Reel
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to your account
          </p>
        </div>
        <form action={handleSubmit} className="mt-8 space-y-6">
          <FormError message={error} />
          {resendSuccess && (
            <FormSuccess message="Confirmation email sent! Check your inbox." />
          )}

          {/* Show resend option when email not confirmed */}
          {showResendOption && !resendSuccess && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-md">
              <p className="text-sm text-amber-800 mb-3">
                Your email address hasn&apos;t been confirmed yet.
              </p>
              <button
                type="button"
                onClick={handleResend}
                disabled={isResending}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResending ? 'Sending...' : 'Resend confirmation email'}
              </button>
            </div>
          )}

          <div className="rounded-md shadow-sm -space-y-px">
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
                className="relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                autoComplete="current-password"
                required
                disabled={isLoading}
                className="relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="text-center space-y-2">
            <p className="text-sm text-gray-600">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-800 underline decoration-2 underline-offset-2 hover:decoration-indigo-800 transition-colors">
                Sign up
              </Link>
            </p>
            <p className="text-sm">
              <Link
                href="/auth/auth-code-error"
                className="text-gray-500 hover:text-indigo-600 transition-colors"
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
