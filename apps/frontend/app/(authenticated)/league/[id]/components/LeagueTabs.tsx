'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getVisibleTabs, isTabActive } from './leagueNav'
import type { League } from '@/types'

interface Props {
  league: League
  outbidCount?: number
  isOwner?: boolean
}

/** Desktop navigation. Below `lg` the bottom bar takes over - see LeagueBottomNav. */
export default function LeagueTabs({ league, outbidCount = 0, isOwner = false }: Props): React.ReactElement {
  const pathname = usePathname()
  const tabs = getVisibleTabs(league, isOwner, outbidCount)

  return (
    <nav
      className="flex gap-2 border-b border-border"
      aria-label="League navigation"
      data-testid="league-tabs"
    >
      {tabs.map((tab) => {
        const isActive = isTabActive(pathname, tab.href)

        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-[11px] text-sm font-medium transition-colors ${
              isActive
                ? 'border-gold text-gold'
                : 'border-transparent text-foreground-secondary hover:text-foreground'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.name}
            {tab.badge && (
              <>
                <span aria-hidden="true" className="rounded-full bg-crimson px-1.5 py-0.5 text-xs text-foreground">
                  {tab.badge}
                </span>
                <span className="sr-only">{tab.badge} notifications</span>
              </>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
