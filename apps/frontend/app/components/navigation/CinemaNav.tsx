'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types'
import NavLogo from './NavLogo'
import NavBreadcrumb from './NavBreadcrumb'
import NavUserMenu from './NavUserMenu'
import NavMobileDrawer from './NavMobileDrawer'
import NotificationBell from '@/components/NotificationBell'

interface Props {
  user: User
  profile?: Pick<Profile, 'display_name' | 'avatar_url'> | null
}

export default function CinemaNav({ user, profile }: Props): React.ReactElement {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Track scroll position for glass effect intensity
  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 20)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll() // Check initial position

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return (
    <>
      <header
        className={`nav-glass fixed top-0 left-0 right-0 z-40 h-16 transition-all duration-300 ${
          isScrolled ? 'nav-glass-scrolled' : ''
        }`}
      >
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-full">
            {/* Left: Logo */}
            <div className="flex-shrink-0">
              <NavLogo />
            </div>

            {/* Center: Breadcrumb (hidden on small mobile) */}
            <div className="hidden sm:flex flex-1 justify-center px-4">
              <NavBreadcrumb />
            </div>

            {/* Right: Notifications + User menu */}
            <div className="flex-shrink-0 flex items-center gap-2">
              <NotificationBell />
              <NavUserMenu
                user={user}
                avatarUrl={profile?.avatar_url ?? null}
                onMenuToggle={() => setIsDrawerOpen(true)}
                showMobileDrawerTrigger
              />
            </div>
          </div>
        </div>

        {/* Mobile breadcrumb - below main nav */}
        <div className="sm:hidden border-t border-border/50 bg-surface/50 px-4 py-2">
          <NavBreadcrumb />
        </div>
      </header>

      {/* Mobile drawer */}
      <NavMobileDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        user={user}
        avatarUrl={profile?.avatar_url ?? null}
      />
    </>
  )
}
