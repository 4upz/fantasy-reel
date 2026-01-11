'use client'

import { useState } from 'react'
import Link from 'next/link'
import { resendConfirmationEmail } from '@/app/login/actions'
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Authentication Error
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            The confirmation link may have expired or already been used.
          </p>
        </div>

        {/* Resend confirmation section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Resend confirmation email
          </h3>

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
                  className="relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                  placeholder="Email address"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Sending...' : 'Resend confirmation email'}
              </button>
            </form>
          )}

          {/* Local development helper */}
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-700">
              <strong>Local development?</strong> Check Mailpit at{' '}
              <a
                href="http://localhost:54324"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-900"
              >
                http://localhost:54324
              </a>
            </p>
          </div>
        </div>

        <div className="text-center">
          <Link
            href="/login"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
