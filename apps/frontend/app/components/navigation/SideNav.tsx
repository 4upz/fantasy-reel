'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types'
import NotificationBell from '@/components/NotificationBell'
import ProfileMenu from './ProfileMenu'
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

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isMobileOpen])

  // Handle escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsMobileOpen(false)
      }
    }
    if (isMobileOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isMobileOpen])

  const closeMobile = useCallback(() => setIsMobileOpen(false), [])

  const globalItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Movies', href: '/movies', icon: <Film className="w-5 h-5" /> },
    { label: 'Wishlist', href: '/wishlist', icon: <Heart className="w-5 h-5" /> },
    { label: 'How to Play', href: '/help', icon: <HelpCircle className="w-5 h-5" /> },
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
          {showLabel && <span className="sidenav-label">{item.label}</span>}
        </span>
      )
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={closeMobile}
        className={`sidenav-item ${active ? 'sidenav-item-active' : ''}`}
        title={item.label}
      >
        {active && <span className="sidenav-active-indicator" />}
        <span className="sidenav-icon">{item.icon}</span>
        {showLabel && <span className="sidenav-label">{item.label}</span>}
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
        >
          <div className="sidenav-brand-icon">
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
              <circle cx="5" cy="12" r="1.5" fill="currentColor" />
              <circle cx="19" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </div>
          {showLabels && (
            <span className="sidenav-brand-text">
              <span className="font-semibold">Fantasy</span>
              <span className="font-light">Reel</span>
            </span>
          )}
        </Link>

        <nav className="sidenav-section">
          {showLabels && <span className="sidenav-section-label">Navigate</span>}
          <div className="sidenav-items">
            {globalItems.map(item => renderNavItem(item, showLabels))}
          </div>
        </nav>
      </div>
    )
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`sidenav sidenav-desktop ${isExpanded ? 'sidenav-expanded' : ''}`}>
        {renderSidebarContent(isExpanded)}

        <button
          onClick={toggleExpanded}
          className="sidenav-toggle"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
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

      {/*
        The account cluster: notifications + the account menu, pinned to the
        top-right corner at every breakpoint. Rendered exactly once so the
        account menu is a single node in the DOM - two copies hidden by media
        query would give `user-menu-button` two matches and break strict-mode
        selectors in the E2E suite. On desktop it floats over the page as a
        capsule, costing no page a header row; below lg it sits inside the
        mobile header bar, which already provides the surface. The wrapper
        ignores pointer events so content underneath stays clickable.
      */}
      <div className="profile-cluster">
        <NotificationBell />
        <span className="profile-cluster-divider" aria-hidden="true" />
        <ProfileMenu displayName={displayName} email={user.email} avatarUrl={profile?.avatar_url} />
      </div>

      {/* Mobile Header Bar */}
      <header className="sidenav-mobile-header">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="sidenav-mobile-trigger"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link href="/dashboard" className="sidenav-mobile-brand">
          <span className="sidenav-mobile-title">Fantasy Reel</span>
        </Link>

      </header>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="sidenav-mobile-overlay" onClick={closeMobile}>
          <div
            className="sidenav-mobile-drawer"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <button
              onClick={closeMobile}
              className="sidenav-mobile-close"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
            {renderSidebarContent(true, true)}
          </div>
        </div>
      )}
    </>
  )
}
