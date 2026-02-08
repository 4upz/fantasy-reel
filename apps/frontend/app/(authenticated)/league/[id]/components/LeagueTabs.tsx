'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { League } from '@/types'

interface Tab {
  name: string
  href: string
  disabled?: boolean
  badge?: number
}

interface Props {
  league: League
  outbidCount?: number
  isOwner?: boolean
}

const PRE_ACTIVE_STATUSES = new Set(['setup', 'drafting', 'counterpicking'])

export default function LeagueTabs({ league, outbidCount = 0, isOwner = false }: Props): React.ReactElement {
  const pathname = usePathname()
  const baseUrl = `/league/${league.id}`
  const isPreActive = PRE_ACTIVE_STATUSES.has(league.status)

  const tabs: Tab[] = [
    { name: 'Overview', href: `${baseUrl}/dashboard` },
    {
      name: 'Standings',
      href: `${baseUrl}/standings`,
      disabled: isPreActive,
    },
    { name: 'Draft', href: `${baseUrl}/draft` },
    {
      name: 'Bidding',
      href: `${baseUrl}/bidding`,
      disabled: isPreActive,
      badge: outbidCount > 0 ? outbidCount : undefined,
    },
    {
      name: 'Trading',
      href: `${baseUrl}/trading`,
      disabled: isPreActive,
    },
    { name: 'Roster', href: `${baseUrl}/roster` },
    ...(isOwner ? [{ name: 'Settings', href: `${baseUrl}/settings` }] : []),
  ]

  return (
    <div className="relative">
      <nav
        className="flex gap-2 border-b border-border overflow-x-auto pr-8 scrollbar-none"
        aria-label="League navigation"
        data-testid="league-tabs"
      >
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)

          if (tab.disabled) {
            return (
              <span
                key={tab.name}
                className="px-4 py-3.5 text-sm font-medium text-foreground-muted/50 border-b-2 border-transparent cursor-not-allowed whitespace-nowrap"
                title="Available after draft completes"
                role="link"
                aria-disabled="true"
              >
                {tab.name}
              </span>
            )
          }

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
