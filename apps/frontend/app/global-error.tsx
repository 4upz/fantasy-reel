'use client'

import { useEffect } from 'react'
import { captureException } from '@/utils/sentry'
import { ThemeScript } from '@/components/theme/ThemeScript'
import { applyThemePreference, parseThemePreference, SYSTEM_THEME_QUERY, THEME_STORAGE_KEY } from '@/utils/theme'

// This boundary replaces the root layout when an error escapes it, so it
// cannot rely on globals.css or the design-token classes being loaded —
// styling here is self-contained on purpose.
const recoveryStyles = `
  :root {
    color-scheme: dark;
    --recovery-background: #0f0f0f;
    --recovery-surface: #1c1c1c;
    --recovery-foreground: #e8e8e8;
    --recovery-secondary: #b8b0a4;
    --recovery-border: #2e2e2e;
    --recovery-gold: #c9a227;
    --recovery-inverse: #0f0f0f;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --recovery-background: #f5f5f4;
    --recovery-surface: #ffffff;
    --recovery-foreground: #242424;
    --recovery-secondary: #55514b;
    --recovery-border: #d3d2ce;
    --recovery-gold: #71570c;
    --recovery-inverse: #ffffff;
  }
  button:focus-visible, a:focus-visible {
    outline: 2px solid var(--recovery-gold);
    outline-offset: 3px;
  }
`

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

  useEffect(() => {
    // React does not execute inline scripts on a client-side boundary mount.
    // Preserve the current preference, including when storage is unavailable.
    let preference = parseThemePreference(document.documentElement.dataset.themePreference)
    try {
      preference = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
    } catch {}
    const update = () => applyThemePreference(preference)
    update()
    const media = window.matchMedia(SYSTEM_THEME_QUERY)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <style>{recoveryStyles}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--recovery-background)',
          color: 'var(--recovery-foreground)',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '1rem',
          lineHeight: 1.5,
          boxSizing: 'border-box',
          padding: '1rem',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '28rem',
            textAlign: 'center',
            backgroundColor: 'var(--recovery-surface)',
            border: '1px solid var(--recovery-border)',
            borderRadius: '0.75rem',
            padding: '2rem',
            boxSizing: 'border-box',
          }}
        >
          <h1
            style={{
              fontSize: '1.25rem',
              lineHeight: 1.3,
              letterSpacing: '-0.015em',
              fontWeight: 700,
              margin: '0 0 0.5rem',
              color: 'var(--recovery-foreground)',
            }}
          >
            Something went wrong
          </h1>
          <p style={{ color: 'var(--recovery-secondary)', margin: '0 0 1.5rem' }}>
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
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                lineHeight: 1.429,
                fontWeight: 600,
                borderRadius: '0.5rem',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--recovery-gold)',
                color: 'var(--recovery-inverse)',
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
                fontSize: '0.875rem',
                lineHeight: 1.429,
                fontWeight: 600,
                borderRadius: '0.5rem',
                color: 'var(--recovery-secondary)',
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
