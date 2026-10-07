'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { useModalDialog } from '@/hooks/useModalDialog'
import { useLeagueNavigation, type LeagueNavigateEvent } from './LeagueNavigation'
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
import { getVisibleTabs, isTabActive, outbidBadgeLabel, splitTabsForBottomBar, type LeagueTab } from './leagueNav'
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
  const { pathname, pendingHref, navigate } = useLeagueNavigation()
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const sheetId = useId()

  const tabs = getVisibleTabs(league, isOwner, outbidCount, seasonCount)
  const { barTabs, moreTabs } = splitTabsForBottomBar(tabs)

  // Route changes come from taps inside the sheet, so it has to close itself.
  useEffect(() => setIsSheetOpen(false), [pathname])

  // The sheet is a modal: left open while the window widens past the bar, it
  // would keep the desktop page inert behind it.
  useEffect(() => {
    if (!isSheetOpen) return
    const desktop = window.matchMedia('(min-width: 1024px)')
    const close = () => { if (desktop.matches) setIsSheetOpen(false) }
    close()
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [isSheetOpen])

  if (barTabs.length === 0) return null

  const hasMore = moreTabs.length > 0
  const columnCount = barTabs.length + (hasMore ? 1 : 0)
  const isMoreActive = moreTabs.some((tab) => isTabActive(pathname, tab.href))

  return (
    <>
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
                onNavigate={(event: LeagueNavigateEvent) => navigate(tab.href, event)}
                aria-busy={pendingHref === tab.href || undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 ${
                  isActive ? 'text-gold' : 'text-foreground-secondary'
                }`}
              >
                <span className="relative">
                  <TabIcon name={tab.name} className="h-[21px] w-[21px]" />
                  {tab.badge && (
                    <>
                      <span
                        aria-hidden="true"
                        className="type-meta type-numeric absolute -top-1 -right-2 min-w-4 rounded-full bg-crimson px-1 text-center text-foreground"
                      >
                        {tab.badge}
                      </span>
                      <span className="sr-only">{outbidBadgeLabel(tab.badge)}</span>
                    </>
                  )}
                </span>
                <span className="type-meta">{tab.name}</span>
              </Link>
            )
          })}

          {hasMore && (
            <button
              type="button"
              onClick={() => setIsSheetOpen((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={isSheetOpen}
              aria-controls={isSheetOpen ? sheetId : undefined}
              className={`flex cursor-pointer flex-col items-center gap-1 ${
                isMoreActive || isSheetOpen ? 'text-gold' : 'text-foreground-secondary'
              }`}
            >
              <MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={1.8} aria-hidden="true" />
              <span className="type-meta">More</span>
            </button>
          )}
        </div>
      </nav>

      {isSheetOpen && (
        <MoreSheet id={sheetId} onClose={() => setIsSheetOpen(false)}>
          {moreTabs.map((tab) => (
            <SheetLink key={tab.name} tab={tab} isActive={isTabActive(pathname, tab.href)} onNavigate={() => setIsSheetOpen(false)} />
          ))}
        </MoreSheet>
      )}
    </>
  )
}

/**
 * The "More" sheet: a native modal dialog pinned to the bottom edge. showModal()
 * moves focus to its first link, keeps Tab inside, makes the page behind inert,
 * and on close (Escape, the dimmed area, a link) returns focus to "More".
 */
function MoreSheet({ id, onClose, children }: { id: string; onClose: () => void; children: React.ReactNode }) {
  const { dialogRef } = useModalDialog(onClose, false, true)

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-label="More league pages"
      aria-modal="true"
      className="animate-slide-up motion-reduce:animate-none fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none max-h-[85dvh] overflow-y-auto rounded-t-2xl border-0 border-t border-border bg-surface p-0 text-foreground backdrop:bg-overlay backdrop:backdrop-blur-sm"
    >
      <div className="pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-border-hover" aria-hidden="true" />
        <ul className="flex flex-col p-2" role="list">
          {children}
        </ul>
      </div>
    </dialog>
  )
}

function SheetLink({ tab, isActive, onNavigate }: { tab: LeagueTab; isActive: boolean; onNavigate: () => void }) {
  const { navigate } = useLeagueNavigation()
  return (
    <li>
      <Link
        href={tab.href}
        onNavigate={(event: LeagueNavigateEvent) => {
          onNavigate()
          navigate(tab.href, event)
        }}
        aria-current={isActive ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-3 type-control transition-colors hover:bg-surface-hover ${
          isActive ? 'text-gold' : 'text-foreground'
        }`}
      >
        <TabIcon name={tab.name} className="h-5 w-5" />
        {tab.name}
        {tab.badge && (
          <>
            <span aria-hidden="true" className="type-meta ml-auto rounded-full bg-crimson px-1.5 py-0.5 text-foreground">{tab.badge}</span>
            <span className="sr-only">{outbidBadgeLabel(tab.badge)}</span>
          </>
        )}
      </Link>
    </li>
  )
}
