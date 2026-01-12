'use client'

import { useState, useRef, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'

interface Props {
  user: User
  onMenuToggle?: () => void
  showMobileDrawerTrigger?: boolean
}

export default function NavUserMenu({ user, onMenuToggle, showMobileDrawerTrigger }: Props): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const initial = user.email?.charAt(0).toUpperCase() || 'U'

  // Handle click outside and escape key to close menu
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div className="flex items-center gap-2">
      {/* Desktop dropdown */}
      <div className="relative hidden md:block" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors group"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          {/* Avatar */}
          <div className="avatar">
            {initial}
          </div>

          {/* Chevron */}
          <svg
            className={`w-4 h-4 text-foreground-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {isOpen && (
          <div className="absolute right-0 mt-2 w-64 py-2 glass card border-border-hover animate-fade-in z-50">
            {/* User info */}
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm text-foreground-muted">Signed in as</p>
              <p className="text-sm font-medium text-foreground truncate">{user.email}</p>
            </div>

            {/* Menu items */}
            <div className="py-1">
              {/* Future: Settings link */}
              {/* <Link href="/settings" className="nav-dropdown-item">Settings</Link> */}
            </div>

            {/* Sign out */}
            <div className="pt-1 border-t border-border">
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="w-full text-left px-4 py-2 text-sm text-foreground-secondary hover:text-crimson hover:bg-surface-hover transition-colors"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Mobile: Avatar as drawer trigger */}
      {showMobileDrawerTrigger && (
        <button
          onClick={onMenuToggle}
          className="md:hidden flex items-center gap-2 p-1 rounded-lg hover:bg-surface-hover transition-colors"
          aria-label="Open navigation menu"
        >
          <div className="avatar">
            {initial}
          </div>
          {/* Hamburger lines */}
          <div className="flex flex-col gap-1">
            <span className="w-4 h-0.5 bg-foreground-secondary" />
            <span className="w-3 h-0.5 bg-foreground-secondary" />
          </div>
        </button>
      )}
    </div>
  )
}
