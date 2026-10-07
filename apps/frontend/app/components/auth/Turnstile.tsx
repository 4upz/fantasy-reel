'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CAPTCHA_ENABLED, TURNSTILE_SITE_KEY } from '@/utils/captcha'

interface TurnstileRenderOptions {
  sitekey: string
  theme: 'light' | 'dark'
  size: 'flexible' | 'compact'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string
      remove: (widgetId: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
// The flexible widget is at least 300px wide; narrower containers get the compact one.
const FLEXIBLE_MIN_WIDTH = 300

let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      script.remove()
      reject(new Error('Failed to load Turnstile'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

/** Shown when a form is submitted before Turnstile has issued a token. */
export const CAPTCHA_PENDING_MESSAGE = 'Complete the security check, then try again.'

/**
 * Tracks the Turnstile token for one form. `ready` is true once the form may
 * submit: always when CAPTCHA is off, otherwise once a token exists. Check it
 * on submit and show CAPTCHA_PENDING_MESSAGE rather than disabling the submit
 * button, which would leave screen-reader users with a dimmed button and no
 * reason. Call `reset` after every submission, since Supabase consumes the
 * token even when the request fails.
 */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)

  const reset = useCallback(() => {
    if (!CAPTCHA_ENABLED) return
    setToken(null)
    setWidgetKey((key) => key + 1)
  }, [])

  return {
    token,
    setToken,
    widgetKey,
    reset,
    ready: !CAPTCHA_ENABLED || token !== null,
  }
}

interface Props {
  onToken: (token: string | null) => void
  className?: string
}

/**
 * Cloudflare Turnstile widget. Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset. Remount it (change its `key`) to
 * get a fresh token.
 */
export default function Turnstile({ onToken, className = '' }: Props): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!CAPTCHA_ENABLED) return

    let widgetId: string | undefined
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        const container = containerRef.current
        if (cancelled || !container || !window.turnstile) return
        widgetId = window.turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          size: container.offsetWidth < FLEXIBLE_MIN_WIDTH ? 'compact' : 'flexible',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [])

  if (!CAPTCHA_ENABLED) return null

  return (
    <div className={className}>
      <div ref={containerRef} className="flex min-h-[65px] justify-center" data-testid="turnstile-widget" />
      {loadFailed && (
        <p className="type-meta mt-2 text-error" role="alert">
          The security check couldn&apos;t load. Check your connection or content blocker, then reload the page.
        </p>
      )}
    </div>
  )
}
