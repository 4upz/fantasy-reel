'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import Avatar from '../Avatar'

interface Props {
  isOpen: boolean
  onClose: () => void
  user: User
  avatarUrl?: string | null
}

export default function NavMobileDrawer({ isOpen, onClose, user, avatarUrl }: Props): React.ReactElement | null {
  const drawerRef = useRef<HTMLDivElement>(null)
  const displayName = user.user_metadata?.display_name || user.email || 'User'

  // Handle body scroll lock, escape key, and initial focus
  useEffect(() => {
    if (!isOpen) return

    document.body.style.overflow = 'hidden'

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)

    // Focus close button on open
    const closeButton = drawerRef.current?.querySelector('button')
    closeButton?.focus()

    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Overlay */}
      <div
        className="drawer-overlay fixed inset-0 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="drawer-panel fixed top-0 right-0 h-full w-[280px] max-w-[85vw] animate-slide-in-right"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="font-display font-semibold text-foreground">Menu</span>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-foreground-muted hover:text-foreground"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* User info */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar src={avatarUrl} name={displayName} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground-muted">Signed in as</p>
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="p-4">
          <ul className="space-y-1">
            <li>
              <Link
                href="/dashboard"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground-secondary hover:text-gold hover:bg-surface-hover transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span>Dashboard</span>
              </Link>
            </li>
            <li>
              <Link
                href="/movies"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground-secondary hover:text-gold hover:bg-surface-hover transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
                <span>Movies</span>
              </Link>
            </li>
            <li>
              <Link
                href="/settings"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground-secondary hover:text-gold hover:bg-surface-hover transition-colors"
              >
                <Settings className="w-5 h-5" />
                <span>Settings</span>
              </Link>
            </li>
          </ul>
        </nav>

        {/* Sign out at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-foreground-secondary hover:text-crimson hover:bg-surface-hover transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
