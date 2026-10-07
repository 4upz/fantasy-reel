'use client'

import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { captureException } from '@/utils/sentry'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    captureException(error)
  }, [error])

  // This replaces whatever the user was interacting with, so the focused
  // control is gone; land them on the explanation instead of <body>.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card animate-fade-in w-full max-w-md space-y-6 p-8 text-center">
        <div className="flex justify-center">
          <AlertTriangle className="h-16 w-16 text-gold" />
        </div>
        <div className="space-y-2">
          <h1 ref={headingRef} tabIndex={-1} className="type-panel text-foreground focus:outline-none">
            Something went wrong
          </h1>
          <p className="type-body text-foreground-secondary">
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
    </main>
  )
}
