import type { ChatInputCommandInteraction } from 'discord.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export const UNLINKED_CHANNEL_MESSAGE =
  'This channel is not linked to a league. Use /set-league first.'

export interface LinkedLeague {
  leagueId: string
  leagueName: string
  leagueStatus: string
  /**
   * The season this league row is. A league is a series that spans years; the
   * row a channel is linked to is one season of it, labelled "{year} Season"
   * wherever the bot names it. Null only for a league predating seasons.
   */
  seasonYear: number | null
  /**
   * Every team that finished top on a completed season -- more than one when
   * the title was shared. Null while the season is still running, and also on
   * seasons completed before winners were recorded, in which case commands
   * fall back to whoever sorts first.
   */
  winnerTeamIds: string[] | null
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
    .select('league_id, leagues(name, status, season_year, winner_team_ids)')
    .eq('channel_id', channelId)
    .maybeSingle()

  if (error || !data) return null

  const league = data.leagues as {
    name?: string
    status?: string
    season_year?: number | null
    winner_team_ids?: string[] | null
  } | null

  return {
    leagueId: data.league_id,
    leagueName: league?.name || 'League',
    leagueStatus: league?.status || 'unknown',
    seasonYear: league?.season_year ?? null,
    winnerTeamIds: league?.winner_team_ids ?? null,
  }
}

/** The season label the bot shows, e.g. "2026 Season". */
export function seasonLabel(seasonYear: number | null): string | null {
  return seasonYear == null ? null : `${seasonYear} Season`
}

/**
 * The teams a finished season recorded as champions, or null.
 *
 * Null covers both "still running" and "finished before winners were
 * recorded"; callers that mark a champion fall back to whoever sorts first in
 * the second case. Shared by /standings and /league so the same season cannot
 * crown different teams in two commands.
 */
export function championTeamIds(
  linked: Pick<LinkedLeague, 'leagueStatus' | 'winnerTeamIds'>
): Set<string> | null {
  return linked.leagueStatus === 'completed' && linked.winnerTeamIds?.length
    ? new Set(linked.winnerTeamIds)
    : null
}

/**
 * Resolves the league linked to the interaction's channel, replying with the
 * "not linked" message and returning null when there is none. Callers must
 * have deferred the reply first.
 */
export async function requireLinkedLeague(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient
): Promise<LinkedLeague | null> {
  const linked = await resolveLinkedLeague(supabase, interaction.channelId)
  if (!linked) await interaction.editReply(UNLINKED_CHANNEL_MESSAGE)
  return linked
}
