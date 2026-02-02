'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { Profile, League } from '@/types'
import Avatar from '../Avatar'
import NotificationBell from '@/components/NotificationBell'
import { createClient } from '@/utils/supabase/client'
import {
  LayoutDashboard,
  Film,
  Settings,
  LogOut,
  Trophy,
  GalleryVerticalEnd,
  Handshake,
  CircleDollarSign,
  Users,
  PanelLeftClose,
  PanelLeft,
  Menu,
  X,
  HelpCircle,
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
  const [league, setLeague] = useState<League | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

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

  // Toggle sidebar expanded state
  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev)
  }, [])

  // Extract league ID from pathname
  const leagueMatch = pathname.match(/^\/league\/([^/]+)/)
  const leagueId = leagueMatch?.[1]

  // Fetch league data when in a league context
  useEffect(() => {
    if (!leagueId) {
      setLeague(null)
      setIsOwner(false)
      return
    }

    const supabase = createClient()

    async function fetchLeague() {
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', leagueId)
        .single()

      if (leagueData) {
        setLeague(leagueData as League)
        setIsOwner(leagueData.owner_id === user.id)
      }
    }

    fetchLeague()
  }, [leagueId, user.id])

  // Handle mobile drawer body scroll lock
  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
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

  // Build navigation items based on context
  const globalItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Movies', href: '/movies', icon: <Film className="w-5 h-5" /> },
    { label: 'How to Play', href: '/help', icon: <HelpCircle className="w-5 h-5" /> },
  ]

  const isPreActive = league && (league.status === 'setup' || league.status === 'drafting' || league.status === 'counterpicking')

  const leagueItems: NavItem[] = league ? [
    { label: 'Overview', href: `/league/${league.id}/dashboard`, icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Standings', href: `/league/${league.id}/standings`, icon: <Trophy className="w-5 h-5" />, disabled: isPreActive || false },
    { label: 'Draft', href: `/league/${league.id}/draft`, icon: <GalleryVerticalEnd className="w-5 h-5" /> },
    { label: 'Bidding', href: `/league/${league.id}/bidding`, icon: <CircleDollarSign className="w-5 h-5" />, disabled: isPreActive || false },
    { label: 'Trading', href: `/league/${league.id}/trading`, icon: <Handshake className="w-5 h-5" />, disabled: isPreActive || false },
    { label: 'Roster', href: `/league/${league.id}/roster`, icon: <Users className="w-5 h-5" /> },
    ...(isOwner ? [{ label: 'Settings', href: `/league/${league.id}/settings`, icon: <Settings className="w-5 h-5" /> }] : []),
  ] : []

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // Render a nav item
  function renderNavItem(item: NavItem, showLabel: boolean) {
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

  // Sidebar content shared between desktop and mobile
  const sidebarContent = (showLabels: boolean, isMobile: boolean = false) => (
    <div className={`sidenav-inner ${isMobile ? 'sidenav-inner-mobile' : ''}`}>
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

      {/* Global Navigation */}
      <nav className="sidenav-section">
        {showLabels && <span className="sidenav-section-label">Navigate</span>}
        <div className="sidenav-items">
          {globalItems.map(item => renderNavItem(item, showLabels))}
        </div>
      </nav>

      {/* League Navigation (contextual) */}
      {league && (
        <nav className="sidenav-section sidenav-section-league">
          {showLabels && (
            <span className="sidenav-section-label sidenav-section-label-league">
              {league.name}
            </span>
          )}
          {!showLabels && (
            <div className="sidenav-league-indicator" title={league.name}>
              <div className="sidenav-league-dot" />
            </div>
          )}
          <div className="sidenav-items">
            {leagueItems.map(item => renderNavItem(item, showLabels))}
          </div>
        </nav>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom section - Settings & User */}
      <div className="sidenav-footer">
        <Link
          href="/settings"
          onClick={closeMobile}
          className={`sidenav-item ${isActive('/settings') ? 'sidenav-item-active' : ''}`}
          title="Account Settings"
        >
          {isActive('/settings') && <span className="sidenav-active-indicator" />}
          <span className="sidenav-icon"><Settings className="w-5 h-5" /></span>
          {showLabels && <span className="sidenav-label">Account</span>}
        </Link>

        {/* User Profile */}
        <div className={`sidenav-user ${showLabels ? 'sidenav-user-expanded' : ''}`}>
          <Avatar src={profile?.avatar_url} name={displayName} size="sm" />
          {showLabels && (
            <div className="sidenav-user-info">
              <span className="sidenav-user-name">{displayName}</span>
              <form action="/auth/signout" method="post" className="sidenav-signout">
                <button type="submit" className="sidenav-signout-btn" data-testid="signout-button">
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar - Click to toggle expand/collapse */}
      <aside className={`sidenav sidenav-desktop ${isExpanded ? 'sidenav-expanded' : ''}`}>
        {sidebarContent(isExpanded)}

        {/* Toggle button at bottom of sidebar */}
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

      {/* Mobile Header Bar */}
      <header className="sidenav-mobile-header">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="sidenav-mobile-trigger"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link href={league ? `/league/${league.id}/dashboard` : '/dashboard'} className="sidenav-mobile-brand">
          <span className="sidenav-mobile-title">
            {league ? league.name : 'Fantasy Reel'}
          </span>
        </Link>

        <div className="sidenav-mobile-actions">
          <NotificationBell />
          <Avatar src={profile?.avatar_url} name={displayName} size="sm" />
        </div>
      </header>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="sidenav-mobile-overlay" onClick={closeMobile}>
          <div
            ref={drawerRef}
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
            {sidebarContent(true, true)}
          </div>
        </div>
      )}
    </>
  )
}
