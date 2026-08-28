'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeftRight,
  BarChart3,
  DollarSign,
  History,
  Home,
  ListOrdered,
  MoreHorizontal,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { getVisibleTabs, isTabActive, splitTabsForBottomBar, type LeagueTab } from './leagueNav'
import type { League } from '@/types'

interface Props {
  league: League
  outbidCount?: number
  isOwner?: boolean
  /** Seasons in this league's series; more than one reveals the History tab. */
  seasonCount?: number
}

const TAB_ICONS: Record<string, LucideIcon> = {
  Overview: Home,
  Standings: BarChart3,
  Draft: ListOrdered,
  Bidding: DollarSign,
  Trading: ArrowLeftRight,
  Roster: Users,
  History,
  Settings,
}

function TabIcon({ name, className }: { name: string; className: string }) {
  const Icon = TAB_ICONS[name] ?? MoreHorizontal
  return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />
}

/**
 * Mobile league navigation. Replaces the horizontally scrolling tab strip, whose
 * overflow was easy to miss - here every destination is either on the bar or one
 * tap away in the sheet.
 */
export default function LeagueBottomNav({
  league,
  outbidCount = 0,
  isOwner = false,
  seasonCount = 1,
}: Props): React.ReactElement | null {
  const pathname = usePathname()
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const tabs = getVisibleTabs(league, isOwner, outbidCount, seasonCount)
  const { barTabs, moreTabs } = splitTabsForBottomBar(tabs)

  // Route changes come from taps inside the sheet, so it has to close itself.
  useEffect(() => setIsSheetOpen(false), [pathname])

  useEffect(() => {
    if (!isSheetOpen) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsSheetOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSheetOpen])

  if (barTabs.length === 0) return null

  const hasMore = moreTabs.length > 0
  const columnCount = barTabs.length + (hasMore ? 1 : 0)
  const isMoreActive = moreTabs.some((tab) => isTabActive(pathname, tab.href))

  return (
    <>
      {isSheetOpen && (
        <div className="lg:hidden">
          <div className="modal-overlay z-40" onClick={() => setIsSheetOpen(false)} aria-hidden="true" />
          <div
            className="animate-slide-up fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface pb-[calc(16px+env(safe-area-inset-bottom))]"
            role="dialog"
            aria-label="More league pages"
          >
            <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-border-hover" />
            <div className="flex flex-col p-2">
              {moreTabs.map((tab) => (
                <SheetLink key={tab.name} tab={tab} isActive={isTabActive(pathname, tab.href)} />
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-[12px] lg:hidden"
        aria-label="League navigation"
        data-testid="league-bottom-nav"
      >
        <div
          className="grid h-[76px] items-start pt-[9px]"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {barTabs.map((tab) => {
            const isActive = isTabActive(pathname, tab.href)
            return (
              <Link
                key={tab.name}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 ${
                  isActive ? 'font-semibold text-gold' : 'font-medium text-foreground-muted'
                }`}
              >
                <span className="relative">
                  <TabIcon name={tab.name} className="h-[21px] w-[21px]" />
                  {tab.badge && (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-2 min-w-[15px] rounded-full bg-crimson px-1 text-center text-[9px] font-bold leading-[15px] text-foreground"
                      >
                        {tab.badge}
                      </span>
                      <span className="sr-only">{tab.badge} notifications</span>
                    </>
                  )}
                </span>
                <span className="text-[10px]">{tab.name}</span>
              </Link>
            )
          })}

          {hasMore && (
            <button
              type="button"
              onClick={() => setIsSheetOpen((open) => !open)}
              aria-expanded={isSheetOpen}
              className={`flex flex-col items-center gap-1 ${
                isMoreActive || isSheetOpen ? 'font-semibold text-gold' : 'font-medium text-foreground-muted'
              }`}
            >
              <MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={1.8} aria-hidden="true" />
              <span className="text-[10px]">More</span>
            </button>
          )}
        </div>
      </nav>
    </>
  )
}

function SheetLink({ tab, isActive }: { tab: LeagueTab; isActive: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={isActive ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] transition-colors hover:bg-surface-hover ${
        isActive ? 'font-semibold text-gold' : 'text-foreground'
      }`}
    >
      <TabIcon name={tab.name} className="h-5 w-5" />
      {tab.name}
      {tab.badge && (
        <span className="ml-auto rounded-full bg-crimson px-1.5 py-0.5 text-xs text-foreground">{tab.badge}</span>
      )}
    </Link>
  )
}
