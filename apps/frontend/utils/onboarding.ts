/**
 * Where a player is on the road from sign-up to their first season, for the
 * onboarding tours (`tours/definitions/`) and the dashboard's Next step card.
 * Pure, so scripts/tests/onboarding.test.cjs can check it without a database.
 */
import type { LeagueStatus } from '@/types'

/** One `league_participants` row as `getCachedMemberships` reads it. */
export interface Membership {
  status: 'active' | 'left'
  leagues: { id: string; name: string; status: LeagueStatus; owner_id: string } | null
}

/** `user_ui_state` key that hides the dashboard's Next step card. */
export const NEXT_STEP_PREF_KEY = 'prefs:next-step'

/**
 * Someone who has had a team in a season that got past its draft. Onboarding
 * tours start by themselves only for everyone else, so a returning player
 * isn't walked through a game they already know.
 */
export function hasPlayedSeason(memberships: readonly Membership[]): boolean {
  return memberships.some((row) => row.leagues?.status === 'active' || row.leagues?.status === 'completed')
}

/** Whether onboarding tours may start by themselves. A failed read (null) says no. */
export function isNewPlayer(memberships: readonly Membership[] | null): boolean {
  return memberships ? !hasPlayedSeason(memberships) : false
}

export type NextStep =
  | { kind: 'draft-live'; leagueId: string; leagueName: string; counterpicking: boolean }
  | { kind: 'setup-owner'; leagueId: string; leagueName: string }
  | { kind: 'setup-member'; leagueId: string; leagueName: string }

/**
 * The most urgent thing a newcomer has to do in a league that hasn't started
 * its season: a live draft first, then a league they run, then one they're
 * waiting on. Null for a returning player, or with no such league - the
 * dashboard's empty state and the welcome tour cover getting into one.
 */
export function nextStep(memberships: readonly Membership[], userId: string): NextStep | null {
  if (hasPlayedSeason(memberships)) return null
  const leagues = memberships.flatMap((row) => (row.status === 'active' && row.leagues ? [row.leagues] : []))

  const live = leagues.find((league) => league.status === 'drafting' || league.status === 'counterpicking')
  if (live) {
    return { kind: 'draft-live', leagueId: live.id, leagueName: live.name, counterpicking: live.status === 'counterpicking' }
  }
  const owned = leagues.find((league) => league.status === 'setup' && league.owner_id === userId)
  if (owned) return { kind: 'setup-owner', leagueId: owned.id, leagueName: owned.name }
  const joined = leagues.find((league) => league.status === 'setup')
  if (joined) return { kind: 'setup-member', leagueId: joined.id, leagueName: joined.name }
  return null
}
