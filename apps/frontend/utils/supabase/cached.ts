import { cache } from 'react'
import { createClient } from './server'
import type { Membership } from '@/utils/onboarding'

/**
 * React.cache() wrapped Supabase utilities for request deduplication.
 *
 * These functions are automatically deduplicated within a single request:
 * - Multiple components calling getCachedUser() share one DB call
 * - Cache is scoped to the request lifecycle (not persisted)
 * - Safe to call from layouts AND pages without redundant queries
 */

/**
 * Cache user auth - commonly called in layout AND every page.
 * Returns the same result for all calls within a request.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  return supabase.auth.getUser()
})

/**
 * Cache profile by user ID.
 * Deduplicates profile fetches across components in the same request.
 */
export const getCachedProfile = cache(async (userId: string) => {
  const supabase = await createClient()
  return supabase.from('profiles').select('*').eq('user_id', userId).single()
})

/**
 * The user's tour state (`user_ui_state`), read once per request by the
 * authenticated layout so tours know what was seen without a client fetch.
 */
export const getCachedUiState = cache(async (userId: string) => {
  const supabase = await createClient()
  return supabase.from('user_ui_state').select('key, value').eq('user_id', userId)
})

/**
 * Every season the user has a team in, with just enough of the league to tell
 * a newcomer from someone who has played a season (`utils/onboarding.ts`).
 * Read from `league_participants` rather than `leagues`, whose read policy also
 * returns leagues the user is only invited to. `left` counts: someone who left
 * a finished season still played it.
 */
export const getCachedMemberships = cache(async (userId: string) => {
  const supabase = await createClient()
  return supabase
    .from('league_participants')
    .select('status, leagues (id, name, status, owner_id)')
    .eq('user_id', userId)
    .in('status', ['active', 'left'])
    .order('joined_at', { ascending: false })
    .returns<Membership[]>()
})

/**
 * Cache league by ID - shared across layout and page components.
 * Returns full league data including all columns.
 */
export const getCachedLeague = cache(async (leagueId: string) => {
  const supabase = await createClient()
  return supabase.from('leagues').select('*').eq('id', leagueId).single()
})

/**
 * Cache participant check - used in layout and pages.
 * Includes the participant's team data via join.
 */
export const getCachedParticipant = cache(
  async (leagueId: string, userId: string) => {
    const supabase = await createClient()
    return supabase
      .from('league_participants')
      .select('*, teams (*)')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .single()
  }
)

/**
 * Cache active participant check - verifies user is an active member.
 * More specific than getCachedParticipant, filters by status='active'.
 */
export const getCachedActiveParticipant = cache(
  async (leagueId: string, userId: string) => {
    const supabase = await createClient()
    return supabase
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()
  }
)

/**
 * Cache participant count for a league.
 * Used in layout headers to show "X / Y participants".
 */
export const getCachedParticipantCount = cache(async (leagueId: string) => {
  const supabase = await createClient()
  return supabase
    .from('league_participants')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('status', 'active')
})
