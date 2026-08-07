'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card animate-fade-in w-full max-w-md space-y-6 p-8 text-center">
        <div className="flex justify-center">
          <AlertTriangle className="h-16 w-16 text-gold" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold text-foreground">
            Something went wrong
          </h1>
          <p className="text-foreground-secondary">
            An unexpected error occurred. You can try again, or head back to your dashboard.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <a href="/dashboard" className="btn btn-ghost">
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
