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
}

export default function LeagueTabs({ league, outbidCount = 0 }: Props) {
  const pathname = usePathname()
  const baseUrl = `/league/${league.id}`

  const tabs: Tab[] = [
    { name: 'Dashboard', href: `${baseUrl}/dashboard` },
    { name: 'Draft', href: `${baseUrl}/draft` },
    {
      name: 'Bidding',
      href: `${baseUrl}/bidding`,
      disabled: league.status === 'setup' || league.status === 'drafting',
      badge: outbidCount > 0 ? outbidCount : undefined,
    },
    { name: 'Roster', href: `${baseUrl}/roster` },
    { name: 'Settings', href: `${baseUrl}/settings` },
  ]

  return (
    <nav className="flex gap-1 border-b border-border overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        const isDisabled = tab.disabled

        if (isDisabled) {
          return (
            <span
              key={tab.name}
              className="px-4 py-3 text-sm font-medium text-foreground-muted/50 border-b-2 border-transparent cursor-not-allowed whitespace-nowrap"
            >
              {tab.name}
            </span>
          )
        }

        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
              isActive
                ? 'text-gold border-gold'
                : 'text-foreground-secondary hover:text-foreground border-transparent'
            }`}
          >
            {tab.name}
            {tab.badge && (
              <span className="bg-crimson text-foreground text-xs px-1.5 py-0.5 rounded-full">
                {tab.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
