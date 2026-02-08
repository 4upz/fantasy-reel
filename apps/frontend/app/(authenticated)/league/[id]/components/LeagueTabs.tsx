'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { League } from '@/types'

interface Tab {
  name: string
  href: string
  badge?: number
}

interface Props {
  league: League
  outbidCount?: number
  isOwner?: boolean
}

type LeagueStatus = League['status']

const ALL_STATUSES: LeagueStatus[] = ['setup', 'drafting', 'counterpicking', 'active', 'completed']

const TAB_VISIBILITY: Record<string, Set<LeagueStatus>> = {
  Overview: new Set(ALL_STATUSES),
  Standings: new Set(['active', 'completed']),
  Draft: new Set(ALL_STATUSES),
  Bidding: new Set(['active']),
  Trading: new Set(['active']),
  Roster: new Set(ALL_STATUSES),
  Settings: new Set(ALL_STATUSES),
}

export default function LeagueTabs({ league, outbidCount = 0, isOwner = false }: Props): React.ReactElement {
  const pathname = usePathname()
  const baseUrl = `/league/${league.id}`

  const allTabs: Tab[] = [
    { name: 'Overview', href: `${baseUrl}/dashboard` },
    { name: 'Standings', href: `${baseUrl}/standings` },
    { name: 'Draft', href: `${baseUrl}/draft` },
    {
      name: 'Bidding',
      href: `${baseUrl}/bidding`,
      badge: outbidCount > 0 ? outbidCount : undefined,
    },
    { name: 'Trading', href: `${baseUrl}/trading` },
    { name: 'Roster', href: `${baseUrl}/roster` },
    ...(isOwner ? [{ name: 'Settings', href: `${baseUrl}/settings` }] : []),
  ]

  const tabs = allTabs.filter((tab) => TAB_VISIBILITY[tab.name]?.has(league.status))

  return (
    <div className="relative">
      <nav
        className="flex gap-2 border-b border-border overflow-x-auto pr-8 scrollbar-none"
        aria-label="League navigation"
        data-testid="league-tabs"
      >
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)

          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                isActive
                  ? 'text-gold border-gold'
                  : 'text-foreground-secondary hover:text-foreground border-transparent'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.name}
              {tab.badge && (
                <>
                  <span aria-hidden="true" className="bg-crimson text-foreground text-xs px-1.5 py-0.5 rounded-full">
                    {tab.badge}
                  </span>
                  <span className="sr-only">{tab.badge} notifications</span>
                </>
              )}
            </Link>
          )
        })}
      </nav>
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none lg:hidden" />
    </div>
  )
}
