'use client'

import { useEffect } from 'react'
import { captureException } from '@/utils/sentry'

// This boundary replaces the root layout when an error escapes it, so it
// cannot rely on globals.css or the design-token classes being loaded —
// styling here is inline and self-contained on purpose.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f0f0f',
          color: '#e8e8e8',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '1rem',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '28rem',
            textAlign: 'center',
            backgroundColor: '#1c1c1c',
            border: '1px solid #2e2e2e',
            borderRadius: '0.75rem',
            padding: '2rem',
          }}
        >
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              margin: '0 0 0.5rem',
              color: '#e8e8e8',
            }}
          >
            Something went wrong
          </h1>
          <p style={{ color: '#b8b0a4', margin: '0 0 1.5rem' }}>
            A critical error occurred. Please try again, or return to the homepage.
          </p>
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 1rem',
                fontWeight: 600,
                borderRadius: '0.5rem',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: '#c9a227',
                color: '#0f0f0f',
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error replaces
                the root layout and must not depend on the App Router being functional */}
            <a
              href="/"
              style={{
                padding: '0.5rem 1rem',
                fontWeight: 600,
                borderRadius: '0.5rem',
                color: '#b8b0a4',
                textDecoration: 'none',
              }}
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
