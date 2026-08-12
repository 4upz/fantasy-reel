import type { League } from '@/types'

export interface LeagueTab {
  name: string
  href: string
  badge?: number
  /** Still reachable, but no longer a primary destination - see TAB_DEMOTED_IN. */
  secondary?: boolean
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

/**
 * Statuses in which a tab stays reachable but stops being a primary destination.
 * Visibility and prominence are separate axes: a demoted tab is still in the list,
 * it just moves to the edge of the desktop strip and into the mobile "More" sheet.
 *
 * Draft keeps its slot through counterpicking, because the board still runs that
 * round. It only steps aside once the league is playing out its season, where it
 * is a record of what happened rather than somewhere you go to act.
 */
const TAB_DEMOTED_IN: Record<string, Set<LeagueStatus>> = {
  Draft: new Set(['active', 'completed']),
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

  return allTabs
    .filter((tab) => TAB_VISIBILITY[tab.name]?.has(league.status))
    .map((tab) => (TAB_DEMOTED_IN[tab.name]?.has(league.status) ? { ...tab, secondary: true } : tab))
}

export function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The four the bottom bar shows by name; anything else falls into "More". Draft
 * only claims its slot while it is a primary tab, so during the season Roster
 * inherits it - the page you actually check once movies start scoring.
 */
const BAR_SLOTS = ['Overview', 'Standings', 'Draft', 'Roster']
const MAX_BAR_TABS = 4

const isBarSlot = (tab: LeagueTab): boolean => BAR_SLOTS.includes(tab.name) && !tab.secondary

/**
 * Splits the visible tabs into the bar and the "More" sheet. When the league's
 * status hides one of the four named slots, a tab is promoted out of the sheet
 * to fill it - so the bar stays a full row and nothing reachable is buried.
 * Demoted tabs are skipped when promoting; putting one back on the bar would
 * undo the demotion.
 */
export function splitTabsForBottomBar(tabs: LeagueTab[]): { barTabs: LeagueTab[]; moreTabs: LeagueTab[] } {
  const barTabs = tabs.filter(isBarSlot)
  const moreTabs = tabs.filter((tab) => !isBarSlot(tab))

  while (barTabs.length < MAX_BAR_TABS) {
    const promotable = moreTabs.findIndex((tab) => !tab.secondary)
    if (promotable === -1) break
    barTabs.push(moreTabs.splice(promotable, 1)[0])
  }

  return { barTabs, moreTabs }
}
