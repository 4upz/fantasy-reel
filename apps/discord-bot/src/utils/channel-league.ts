import type { SupabaseClient } from '@supabase/supabase-js'

export const UNLINKED_CHANNEL_MESSAGE =
  'This channel is not linked to a league. Use /set-league first.'

export interface LinkedLeague {
  leagueId: string
  leagueName: string
  leagueStatus: string
}

/**
 * Resolves the league linked to a Discord channel via `discord_channels`.
 * Returns null if the channel isn't linked or the lookup failed.
 */
export async function resolveLinkedLeague(
  supabase: SupabaseClient,
  channelId: string
): Promise<LinkedLeague | null> {
  const { data, error } = await supabase
    .from('discord_channels')
    .select('league_id, leagues(name, status)')
    .eq('channel_id', channelId)
    .maybeSingle()

  if (error || !data) return null

  const league = data.leagues as { name?: string; status?: string } | null
  return {
    leagueId: data.league_id,
    leagueName: league?.name || 'League',
    leagueStatus: league?.status || 'unknown',
  }
}
