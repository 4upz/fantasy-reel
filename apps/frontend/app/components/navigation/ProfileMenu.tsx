'use client'

import { useCallback, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Settings, LogOut } from 'lucide-react'
import Avatar from '../Avatar'
import ThemeSelector from '@/components/theme/ThemeSelector'
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss'

interface Props {
  displayName: string
  email?: string | null
  avatarUrl?: string | null
}

/**
 * The single home for account actions. Deliberately not part of SideNav's item
 * list: navigation moves you around the app, this menu acts on your account.
 * Rendered in the top-right cluster on desktop and in the mobile header.
 *
 * A disclosure, not an ARIA menu: the panel mixes links, theme radios and a
 * form, so it keeps native Tab order instead of menu arrow-key semantics.
 */
export default function ProfileMenu({ displayName, email, avatarUrl }: Props): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const close = useCallback(() => setIsOpen(false), [])

  usePopoverDismiss(isOpen, close, menuRef, triggerRef)

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(open => !open)}
        className="profile-menu-trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label="Account menu"
        data-testid="user-menu-button"
      >
        <Avatar src={avatarUrl} name={displayName} size="sm" />
      </button>

      {isOpen && (
        <div id={panelId} className="profile-menu-panel animate-fade-in">
          <div className="profile-menu-identity">
            {/* The name is right beside it, so the picture adds nothing to read. */}
            <Avatar src={avatarUrl} name={displayName} size="sm" decorative />
            <div className="profile-menu-identity-text">
              <span className="profile-menu-name">{displayName}</span>
              {email && <span className="profile-menu-email">{email}</span>}
            </div>
          </div>

          <Link
            href="/settings"
            onClick={close}
            className="profile-menu-item"
          >
            <Settings className="w-4 h-4" />
            <span>Account settings</span>
          </Link>

          <div className="border-t border-border px-2 py-3 mt-1">
            <ThemeSelector />
          </div>

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
