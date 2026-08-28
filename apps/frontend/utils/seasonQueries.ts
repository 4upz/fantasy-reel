import type { SupabaseClient } from '@supabase/supabase-js'
import type { League, SeasonSummary, StandingRow } from '@/types'

/**
 * Season reads shared by the server pages and the client components that need
 * them. Every function takes the caller's own Supabase client, so the same code
 * serves a server component and a `'use client'` one - and every read runs
 * under the caller's RLS rather than a service role.
 */

/** One season's ranking. The only source of rank anywhere in the app. */
export async function fetchStandings(
  supabase: SupabaseClient,
  leagueId: string
): Promise<StandingRow[]> {
  const { data, error } = await supabase.rpc('league_standings', { p_league_id: leagueId })
  if (error) {
    console.error('Error loading standings:', error)
    return []
  }
  return (data ?? []) as StandingRow[]
}

/**
 * Every season of a series as full league rows, newest first.
 *
 * The `series_seasons` view is the cheaper read, but it does not carry
 * `final_standings` - so the history page, which needs a champion and two
 * runners-up per season, reads the table instead. That is one query in place of
 * one ranking RPC per season.
 */
export async function fetchSeriesSeasonRecords(
  supabase: SupabaseClient,
  seriesId: string
): Promise<League[]> {
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('series_id', seriesId)
    .order('season_year', { ascending: false })

  if (error) {
    console.error('Error loading season records:', error)
    return []
  }
  return (data ?? []) as League[]
}

/** Every season of a series the caller can see, newest first. */
export async function fetchSeriesSeasons(
  supabase: SupabaseClient,
  seriesId: string
): Promise<SeasonSummary[]> {
  const { data, error } = await supabase
    .from('series_seasons')
    .select('league_id, season_year, status, completed_at, winner_team_ids')
    .eq('series_id', seriesId)
    .order('season_year', { ascending: false })

  if (error) {
    console.error('Error loading seasons:', error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.league_id as string,
    season_year: row.season_year as number,
    status: row.status as SeasonSummary['status'],
    completed_at: row.completed_at as string | null,
    winner_team_ids: row.winner_team_ids as string[] | null,
  }))
}

/**
 * Who owns each of these teams, by team id.
 *
 * Teams are per-season rows, so a team id only ever means something within its
 * own season - the identity that survives a rollover is the person behind it.
 * Both champion surfaces go through this, so they agree on who a winning team
 * belonged to.
 *
 * Costs nothing when there are no teams to resolve: it never reaches the
 * database.
 */
async function fetchTeamOwnerUserIds(
  supabase: SupabaseClient,
  teamIds: string[]
): Promise<Map<string, string>> {
  if (teamIds.length === 0) return new Map()

  const { data: teams } = await supabase
    .from('teams')
    .select('id, league_participants!inner(user_id)')
    .in('id', teamIds)

  const owners = new Map<string, string>()
  for (const team of teams ?? []) {
    // `!inner` guarantees the join matched, but PostgREST still types the
    // embed as an array-or-object depending on the relationship it inferred.
    const participant = team.league_participants as unknown as { user_id: string } | null
    if (participant?.user_id) owners.set(team.id as string, participant.user_id)
  }
  return owners
}

/**
 * Which of these seasons the given user won, by league id.
 *
 * Costs nothing on a league that has never completed a season: with no winning
 * team ids to resolve, it never reaches the database.
 */
export async function fetchWonSeasonIds(
  supabase: SupabaseClient,
  userId: string,
  seasons: SeasonSummary[]
): Promise<string[]> {
  const owners = await fetchTeamOwnerUserIds(
    supabase,
    seasons.flatMap((season) => season.winner_team_ids ?? [])
  )

  return seasons
    .filter((season) =>
      (season.winner_team_ids ?? []).some((teamId) => owners.get(teamId) === userId)
    )
    .map((season) => season.id)
}

/** Who is defending a title this season, and the season they won. */
export interface ReigningChampions {
  seasonYear: number
  userIds: string[]
}

/**
 * The users who won the previous completed season of this series.
 *
 * Teams are per-season rows, so last year's `winner_team_ids` mean nothing
 * against this year's teams - the identity that survives a rollover is the
 * person. Resolving through `league_participants` is what lets the crown find
 * the same player under a new team row, or a renamed team.
 *
 * Null for the first season of a series, and for a season that is itself
 * completed (its champion banner already says who won).
 */
export async function fetchReigningChampions(
  supabase: SupabaseClient,
  league: Pick<League, 'series_id' | 'season_year' | 'status'>
): Promise<ReigningChampions | null> {
  if (league.status === 'completed') return null

  const { data: previous } = await supabase
    .from('series_seasons')
    .select('season_year, winner_team_ids')
    .eq('series_id', league.series_id)
    .eq('status', 'completed')
    .lt('season_year', league.season_year)
    .order('season_year', { ascending: false })
    .limit(1)
    .maybeSingle()

  const owners = await fetchTeamOwnerUserIds(
    supabase,
    (previous?.winner_team_ids ?? []) as string[]
  )

  const userIds = [...owners.values()]
  if (userIds.length === 0) return null

  return { seasonYear: previous!.season_year as number, userIds }
}
