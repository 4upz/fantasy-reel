'use client'

import { useState, useEffect, useCallback, useId } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types'
import { useModalDialog } from '@/hooks/useModalDialog'
import NotificationBell from '@/components/NotificationBell'
import ProfileMenu from './ProfileMenu'
import BrandLogo from '../BrandLogo'
import SocialLinks from '../SocialLinks'
import {
  LayoutDashboard,
  Film,
  PanelLeftClose,
  PanelLeft,
  Menu,
  X,
  HelpCircle,
  Heart,
} from 'lucide-react'

const SIDEBAR_COLLAPSED_WIDTH = 68
const SIDEBAR_EXPANDED_WIDTH = 240
const STORAGE_KEY = 'sidenav-expanded'

interface Props {
  user: User
  profile?: Pick<Profile, 'display_name' | 'avatar_url'> | null
}

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  disabled?: boolean
  badge?: number
}

export default function SideNav({ user, profile }: Props): React.ReactElement {
  const pathname = usePathname()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const sidebarId = useId()

  const displayName = profile?.display_name || user.user_metadata?.display_name || user.email || 'User'

  // Initialize expanded state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') {
      setIsExpanded(true)
    }
  }, [])

  // Update CSS custom property and localStorage when expanded state changes
  useEffect(() => {
    const width = isExpanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH
    document.documentElement.style.setProperty('--sidenav-width', `${width}px`)
    localStorage.setItem(STORAGE_KEY, String(isExpanded))
  }, [isExpanded])

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev)
  }, [])

  const closeMobile = useCallback(() => setIsMobileOpen(false), [])

  const globalItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Movies', href: '/movies', icon: <Film className="w-5 h-5" /> },
    { label: 'Wishlist', href: '/wishlist', icon: <Heart className="w-5 h-5" /> },
    { label: 'How to play', href: '/help', icon: <HelpCircle className="w-5 h-5" /> },
  ]

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  function renderNavItem(item: NavItem, showLabel: boolean): React.ReactElement {
    const active = isActive(item.href)

    if (item.disabled) {
      return (
        <span
          key={item.href}
          className="sidenav-item sidenav-item-disabled"
          title={item.label}
        >
          <span className="sidenav-icon">{item.icon}</span>
          <span className={showLabel ? 'sidenav-label' : 'sr-only'}>{item.label}</span>
        </span>
      )
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={closeMobile}
        className={`sidenav-item ${active ? 'sidenav-item-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        title={item.label}
      >
        {active && <span className="sidenav-active-indicator" />}
        <span className="sidenav-icon">{item.icon}</span>
        {/* Collapsed, the icon carries the meaning; screen readers still get the name. */}
        <span className={showLabel ? 'sidenav-label' : 'sr-only'}>{item.label}</span>
        {item.badge && item.badge > 0 && (
          <span className="sidenav-badge">{item.badge}</span>
        )}
      </Link>
    )
  }

  function renderSidebarContent(showLabels: boolean, isMobile: boolean = false): React.ReactElement {
    return (
      <div className={`sidenav-inner ${isMobile ? 'sidenav-inner-mobile safe-area-bottom' : ''}`}>
        {/* Logo / Brand */}
        <Link
          href="/dashboard"
          onClick={closeMobile}
          className="sidenav-brand"
          title="Fantasy Reel"
          aria-label="Fantasy Reel dashboard"
        >
          <BrandLogo
            compact
            markOnly={!showLabels}
            className={showLabels ? 'h-auto w-44 max-w-full' : 'h-auto w-7 shrink-0'}
          />
        </Link>

        <nav className="sidenav-section" aria-label="Main">
          {showLabels && <span className="sidenav-section-label">Navigate</span>}
          <div className="sidenav-items">
            {globalItems.map(item => renderNavItem(item, showLabels))}
          </div>
        </nav>

        <div className="sidenav-footer">
          <SocialLinks />
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside id={sidebarId} className={`sidenav sidenav-desktop ${isExpanded ? 'sidenav-expanded' : ''}`}>
        {renderSidebarContent(isExpanded)}

        <button
          onClick={toggleExpanded}
          className="sidenav-toggle"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={isExpanded}
          aria-controls={sidebarId}
          title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          data-testid="sidebar-toggle"
        >
          {isExpanded ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeft className="w-4 h-4" />
          )}
        </button>
      </aside>

      {/* Mobile Header Bar */}
      <header className="sidenav-mobile-header">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="sidenav-mobile-trigger"
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={isMobileOpen}
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link href="/dashboard" className="sidenav-mobile-brand" aria-label="Fantasy Reel dashboard">
          <BrandLogo compact className="h-auto w-36 max-w-full" />
        </Link>

      </header>

      {/*
        The account cluster: notifications + the account menu, pinned to the
        top-right corner at every breakpoint. Rendered exactly once so the
        account menu is a single node in the DOM - two copies hidden by media
        query would give `user-menu-button` two matches and break strict-mode
        selectors in the E2E suite. On desktop it floats over the page as a
        capsule, costing no page a header row; below lg it sits inside the
        mobile header bar, which already provides the surface. The wrapper
        ignores pointer events so content underneath stays clickable.

        It follows the mobile header in the DOM so Tab order matches the bar's
        left-to-right order (menu, logo, bell, account), and it is a named
        region so screen-reader users can jump to it like the other landmarks.
      */}
      <section className="profile-cluster" aria-label="Notifications and account">
        <NotificationBell />
        <span className="profile-cluster-divider" aria-hidden="true" />
        <ProfileMenu displayName={displayName} email={user.email} avatarUrl={profile?.avatar_url} />
      </section>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <MobileDrawer onClose={closeMobile}>
          <button
            onClick={closeMobile}
            className="sidenav-mobile-close"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
          {renderSidebarContent(true, true)}
        </MobileDrawer>
      )}
    </>
  )
}

/** The mobile navigation drawer: a native modal dialog anchored to the left edge. */
function MobileDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }): React.ReactElement {
  const { dialogRef } = useModalDialog(onClose, false, true)

  return (
    <dialog
      ref={dialogRef}
      aria-label="Navigation menu"
      aria-modal="true"
      className="sidenav-mobile-drawer"
    >
      {children}
    </dialog>
  )
}
