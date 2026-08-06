import type { League } from '@/types'

export interface LeagueTab {
  name: string
  href: string
  badge?: number
}

type LeagueStatus = League['status']

const ALL_STATUSES: LeagueStatus[] = ['setup', 'drafting', 'counterpicking', 'active', 'completed']

export const TAB_VISIBILITY: Record<string, Set<LeagueStatus>> = {
  Overview: new Set(ALL_STATUSES),
  Standings: new Set(['active', 'completed']),
  Draft: new Set(ALL_STATUSES),
  Bidding: new Set(['active']),
  Trading: new Set(['active']),
  Roster: new Set(ALL_STATUSES),
  Settings: new Set(ALL_STATUSES),
}

/** Tabs the league's current status makes reachable, in canonical order. */
export function getVisibleTabs(league: League, isOwner: boolean, outbidCount: number): LeagueTab[] {
  const baseUrl = `/league/${league.id}`

  const allTabs: LeagueTab[] = [
    { name: 'Overview', href: `${baseUrl}/dashboard` },
    { name: 'Standings', href: `${baseUrl}/standings` },
    { name: 'Draft', href: `${baseUrl}/draft` },
    { name: 'Bidding', href: `${baseUrl}/bidding`, badge: outbidCount > 0 ? outbidCount : undefined },
    { name: 'Trading', href: `${baseUrl}/trading` },
    { name: 'Roster', href: `${baseUrl}/roster` },
    ...(isOwner ? [{ name: 'Settings', href: `${baseUrl}/settings` }] : []),
  ]

  return allTabs.filter((tab) => TAB_VISIBILITY[tab.name]?.has(league.status))
}

export function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The four the bottom bar shows by name; anything else falls into "More". */
const BAR_SLOTS = ['Overview', 'Standings', 'Draft', 'Bidding']
const MAX_BAR_TABS = 4

/**
 * Splits the visible tabs into the bar and the "More" sheet. When the league's
 * status hides one of the four named slots, a tab is promoted out of the sheet
 * to fill it - so the bar stays a full row and nothing reachable is buried.
 */
export function splitTabsForBottomBar(tabs: LeagueTab[]): { barTabs: LeagueTab[]; moreTabs: LeagueTab[] } {
  const barTabs = tabs.filter((tab) => BAR_SLOTS.includes(tab.name))
  const moreTabs = tabs.filter((tab) => !BAR_SLOTS.includes(tab.name))

  while (barTabs.length < MAX_BAR_TABS && moreTabs.length > 0) {
    barTabs.push(moreTabs.shift()!)
  }

  return { barTabs, moreTabs }
}
