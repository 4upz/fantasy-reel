'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { createClient } from '@/utils/supabase/client'
import { fetchStandings } from '@/utils/seasonQueries'
import {
  computeProjectedStandings,
  hasProjectedLegs,
  type ProjectedStanding,
  type ProjectedStandingCounterpick,
  type ProjectedStandingHolding,
  type ProjectedStandingTeam,
} from '@/utils/projectedStandings'
import { useMovieProjections, useProjectionsEnabled } from './useMovieProjections'

export interface ProjectedStandingInputs {
  teams: ProjectedStandingTeam[]
  holdings: ProjectedStandingHolding[]
  counterpicks: ProjectedStandingCounterpick[]
}

/**
 * The projected table for a league, or null while there is nothing to show:
 * projections off, still loading, or no movie that rests on a projection.
 * Waits for every movie's answer so a total never flickers part-way.
 */
export function useProjectedStandings(
  inputs: ProjectedStandingInputs | null | undefined,
  doublePointsOver90: boolean
): ProjectedStanding[] | null {
  const tmdbIds = useMemo(
    () => [...new Set([...(inputs?.holdings ?? []), ...(inputs?.counterpicks ?? [])].map((leg) => leg.tmdb_id))],
    [inputs]
  )
  const projections = useMovieProjections(tmdbIds)

  return useMemo(() => {
    if (!inputs || tmdbIds.length === 0 || projections.size < tmdbIds.length) return null
    const standings = computeProjectedStandings({ ...inputs, projections, doublePointsOver90 })
    return hasProjectedLegs(standings) ? standings : null
  }, [inputs, tmdbIds, projections, doublePointsOver90])
}

interface HoldingRow {
  team_id: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
  combined_score: number | null
  fantasy_points: number | null
}

interface CounterpickRow {
  counterpicker_team_id: string
  fantasy_points: number | null
  movies: {
    tmdb_id: number
    title: string
    release_date: string | null
    poster_url: string | null
    combined_score: number | null
  } | null
}

/** Every team's roster and counterpicks, read the way the standings page reads them. */
async function fetchProjectedStandingInputs(leagueId: string): Promise<ProjectedStandingInputs> {
  const supabase = createClient()
  const [standings, holdings, counterpicks] = await Promise.all([
    fetchStandings(supabase, leagueId),
    supabase
      .from('team_holdings')
      .select('team_id, tmdb_id, title, release_date, poster_url, combined_score, fantasy_points')
      .eq('league_id', leagueId),
    supabase
      .from('counterpicks')
      .select('counterpicker_team_id, fantasy_points, movies(tmdb_id, title, release_date, poster_url, combined_score)')
      .eq('league_id', leagueId),
  ])
  if (holdings.error) throw holdings.error
  if (counterpicks.error) throw counterpicks.error
  return {
    teams: standings.map((row) => ({
      team_id: row.team_id,
      team_name: row.team_name,
      earned: row.total_points,
      rank: row.rank,
    })),
    holdings: (holdings.data ?? []) as HoldingRow[],
    counterpicks: ((counterpicks.data ?? []) as unknown as CounterpickRow[]).flatMap((row) =>
      row.movies ? [{ ...row.movies, counterpicker_team_id: row.counterpicker_team_id, fantasy_points: row.fantasy_points }] : []
    ),
  }
}

/**
 * The projected table for a page that does not already hold every roster
 * (the roster page). Reads nothing until this league's projections are known
 * to be on, so a league without them never makes these queries.
 */
export function useLeagueProjectedStandings(
  leagueId: string,
  doublePointsOver90: boolean,
  active: boolean
): ProjectedStanding[] | null {
  const enabled = useProjectionsEnabled()
  const { data } = useSWR(enabled && active ? ['projected-standing-inputs', leagueId] : null, () =>
    fetchProjectedStandingInputs(leagueId)
  )
  return useProjectedStandings(data, doublePointsOver90)
}
