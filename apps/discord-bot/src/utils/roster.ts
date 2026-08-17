import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A team's active roster comes from `team_holdings`, the view that unions
 * `draft_picks` and `pickups` and drops dropped rows itself -- so there is no
 * `dropped_at` filter to forget here (docs/PLAN-discord-bot-parity.md §0).
 * `/roster` shipped listing drafted movies only because it queried
 * `draft_picks` alone; the view closes that class of bug by construction.
 *
 * The view is denormalized -- movie and team columns are flat, and PostgREST
 * embeds do not resolve through it -- so `select` is a plain column list.
 * `team_id` already implies the league (a team belongs to exactly one league
 * participant), so no league filter is needed.
 *
 * Ordering is acquisition order: drafted movies (by pick number within a draft
 * round's timestamp) first, then pickups as they were won.
 *
 * Errors are returned rather than thrown, mirroring the Supabase client's
 * `{ data, error }` shape.
 */
export async function fetchTeamHoldings<T>(
  supabase: SupabaseClient,
  teamId: string,
  select: string
): Promise<{ data: T[]; error: unknown }> {
  const { data, error } = await supabase
    .from('team_holdings')
    .select(select)
    .eq('team_id', teamId)
    .order('acquired_at', { ascending: true })
    .order('pick_number', { ascending: true, nullsFirst: false })
    .returns<T[]>()

  return { data: data || [], error }
}
