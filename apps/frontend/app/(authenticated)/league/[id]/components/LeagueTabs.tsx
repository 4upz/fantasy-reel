'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayoutEffect, useRef, useState } from 'react'
import { getVisibleTabs, isTabActive } from './leagueNav'
import type { League } from '@/types'

interface Props {
  league: League
  outbidCount?: number
  isOwner?: boolean
  /** Seasons in this league's series; more than one reveals the History tab. */
  seasonCount?: number
}

/** Desktop navigation. Below `lg` the bottom bar takes over - see LeagueBottomNav. */
export default function LeagueTabs({
  league,
  outbidCount = 0,
  isOwner = false,
  seasonCount = 1,
}: Props): React.ReactElement {
  const pathname = usePathname()
  const tabs = getVisibleTabs(league, isOwner, outbidCount, seasonCount)
  const navRef = useRef<HTMLElement>(null)
  const activeTabRef = useRef<HTMLAnchorElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const tabSignature = tabs.map((tab) => tab.href).join('|')

  useLayoutEffect(() => {
    const nav = navRef.current
    const activeTab = activeTabRef.current
    if (!nav || !activeTab) {
      setIndicator(null)
      return
    }

    const updateIndicator = () => {
      const nextIndicator = {
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      }

      setIndicator((current) =>
        current?.left === nextIndicator.left && current.width === nextIndicator.width
          ? current
          : nextIndicator,
      )
    }

    updateIndicator()

    const resizeObserver = new ResizeObserver(updateIndicator)
    resizeObserver.observe(nav)
    resizeObserver.observe(activeTab)

    return () => resizeObserver.disconnect()
  }, [pathname, tabSignature])

  return (
    <nav
      ref={navRef}
      className="relative flex gap-2 border-b border-border"
      aria-label="League navigation"
      data-testid="league-tabs"
    >
      {tabs.map((tab) => {
        const isActive = isTabActive(pathname, tab.href)

        // A demoted tab keeps its place in the row and differs only in weight of
        // colour - it has already given up its position, so restyling it further
        // would just make it conspicuous again.
        const inactiveText = tab.secondary ? 'text-foreground-muted' : 'text-foreground-secondary'

        return (
          <Link
            key={tab.name}
            ref={isActive ? activeTabRef : undefined}
            href={tab.href}
            data-testid={tab.secondary ? 'league-tab-secondary' : undefined}
            className={`type-control flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3.5 py-[11px] transition-colors ${
              isActive ? 'text-gold' : `${inactiveText} hover:text-foreground`
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.name}
            {tab.badge && (
              <>
                <span aria-hidden="true" className="type-meta rounded-full bg-crimson px-1.5 py-0.5 text-foreground">
                  {tab.badge}
                </span>
                <span className="sr-only">{tab.badge} notifications</span>
              </>
            )}
          </Link>
        )
      })}

      {indicator && (
        <span
          aria-hidden="true"
          data-testid="league-tab-indicator"
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-gold transition-[transform,width] duration-300 ease-out motion-reduce:transition-none"
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: indicator.width,
          }}
        />
      )}
    </nav>
  )
}
