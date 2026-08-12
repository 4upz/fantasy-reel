import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A team's active roster = its `draft_picks` plus its `pickups`, both minus
 * drops (docs/PLAN-discord-bot-parity.md §0). Commands that read a roster must
 * query both tables -- `/roster` shipped listing drafted movies only because it
 * queried `draft_picks` alone.
 *
 * `select` is the PostgREST column list, so callers can ask for just the movie
 * fields they render. `team_id` already implies the league (a team belongs to
 * exactly one league participant), so no league filter is needed.
 *
 * Errors are returned rather than thrown, mirroring the Supabase client's
 * `{ data, error }` shape; the first failing side wins.
 */
export async function fetchTeamHoldings<T>(
  supabase: SupabaseClient,
  teamId: string,
  select: string
): Promise<{ data: T[]; error: unknown }> {
  const [drafted, pickedUp] = await Promise.all([
    supabase
      .from('draft_picks')
      .select(select)
      .eq('team_id', teamId)
      .is('dropped_at', null)
      .order('pick_number', { ascending: true })
      .returns<T[]>(),
    supabase
      .from('pickups')
      .select(select)
      .eq('team_id', teamId)
      .is('dropped_at', null)
      .order('picked_up_at', { ascending: true })
      .returns<T[]>(),
  ])

  return {
    data: [...(drafted.data || []), ...(pickedUp.data || [])],
    error: drafted.error || pickedUp.error,
  }
}
