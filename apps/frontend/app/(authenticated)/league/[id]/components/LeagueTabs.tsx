'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

  return (
    <nav
      className="flex gap-2 border-b border-border"
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
            href={tab.href}
            data-testid={tab.secondary ? 'league-tab-secondary' : undefined}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-[11px] text-sm font-medium transition-colors ${
              isActive ? 'border-gold text-gold' : `border-transparent ${inactiveText} hover:text-foreground`
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
