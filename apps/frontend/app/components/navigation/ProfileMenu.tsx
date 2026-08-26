'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Settings, LogOut } from 'lucide-react'
import Avatar from '../Avatar'

interface Props {
  displayName: string
  email?: string | null
  avatarUrl?: string | null
}

/**
 * The single home for account actions. Deliberately not part of SideNav's item
 * list: navigation moves you around the app, this menu acts on your account.
 * Rendered in the top-right cluster on desktop and in the mobile header.
 */
export default function ProfileMenu({ displayName, email, avatarUrl }: Props): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        onClick={() => setIsOpen(open => !open)}
        className="profile-menu-trigger"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Account menu"
        data-testid="user-menu-button"
      >
        <Avatar src={avatarUrl} name={displayName} size="sm" />
      </button>

      {isOpen && (
        <div className="profile-menu-panel animate-fade-in">
          <div className="profile-menu-identity">
            <Avatar src={avatarUrl} name={displayName} size="sm" />
            <div className="profile-menu-identity-text">
              <span className="profile-menu-name">{displayName}</span>
              {email && <span className="profile-menu-email">{email}</span>}
            </div>
          </div>

          <Link
            href="/settings"
            onClick={() => setIsOpen(false)}
            className="profile-menu-item"
          >
            <Settings className="w-4 h-4" />
            <span>Account settings</span>
          </Link>

          <form action="/auth/signout" method="post" className="profile-menu-signout">
            <button
              type="submit"
              className="profile-menu-item profile-menu-item-danger"
              data-testid="signout-button"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
