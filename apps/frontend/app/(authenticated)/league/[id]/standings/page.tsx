import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import StandingsClient from './StandingsClient'
import { HOLDING_MOVIE_COLUMNS, holdingMovie, type HoldingMovieRow } from '@/utils/holdings'
import { fetchReigningChampions, fetchStandings } from '@/utils/seasonQueries'
import { resolveChampions, seasonStandings } from '@/utils/seasons'
import type {
  League,
  ParticipantWithTeamScore,
  CounterpickWithScores,
  DraftHolding,
  PickupHolding,
  TeamHolding,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

/** The `team_holdings` columns the standings select. */
type StandingsHolding = HoldingMovieRow &
  Pick<
    TeamHolding,
    | 'holding_id'
    | 'source'
    | 'team_id'
    | 'round'
    | 'pick_number'
    | 'amount_paid'
    | 'counterpicked_by_team_id'
  >

export default async function StandingsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Standings only available for active or completed leagues
  if (league.status !== 'active' && league.status !== 'completed') {
    redirect(`/league/${id}`)
  }

  // Check if user is a participant in this league
  const { data: userParticipant } = await supabase
    .from('league_participants')
    .select('id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!userParticipant) {
    redirect('/dashboard')
  }

  const typedLeague = league as League

  // Parallelize independent queries (async-parallel optimization)
  //
  // Every roster comes from team_holdings, which is already limited to what
  // teams still hold - matching recalculate_team_score_with_counterpicks().
  // Counterpicks deliberately are not: they survive a drop and keep scoring for
  // the counterpicker (see CLAUDE.md "Counterpicks x drops x trades").
  const [participantsResult, holdingsResult, counterpicksResult, standings, reigningChampions] = await Promise.all([
    supabase
      .from('league_participants')
      .select(
        `
        *,
        teams (
          *,
          team_scores (*),
          team_budgets (*)
        )
      `
      )
      .eq('league_id', id)
      .eq('status', 'active')
      .order('draft_order', { ascending: true }),
    supabase
      .from('team_holdings')
      .select(
        `holding_id, source, team_id, round, pick_number, amount_paid, counterpicked_by_team_id, ${HOLDING_MOVIE_COLUMNS}`
      )
      .eq('league_id', id)
      .order('source', { ascending: true })
      .order('round', { ascending: true })
      .order('pick_number', { ascending: true })
      .order('acquired_at', { ascending: true }),
    supabase
      .from('counterpicks')
      .select(
        `
        *,
        movies (*),
        target_team:teams!counterpicks_target_team_id_fkey (name)
      `
      )
      .eq('league_id', id)
      .order('pick_order', { ascending: true }),
    // The live ranking is still needed for a running season, and as the
    // fallback for a completed one stamped before final_standings existed.
    typedLeague.final_standings?.length ? [] : fetchStandings(supabase, id),
    fetchReigningChampions(supabase, typedLeague),
  ])

  const { data: participants } = participantsResult
  const { data: counterpicks } = counterpicksResult

  const holdings = (holdingsResult.data ?? []) as StandingsHolding[]

  const draftPicks: DraftHolding[] = holdings
    .filter((holding) => holding.source === 'draft')
    .map((holding) => ({
      id: holding.holding_id,
      team_id: holding.team_id,
      movie_id: holding.movie_id,
      // Never null on a draft holding: the view carries the pick's own columns.
      round: holding.round!,
      pick_number: holding.pick_number!,
      counterpicked_by_team_id: holding.counterpicked_by_team_id,
      movie: holdingMovie(holding),
    }))

  const pickups: PickupHolding[] = holdings
    .filter((holding) => holding.source === 'pickup')
    .map((holding) => ({
      id: holding.holding_id,
      team_id: holding.team_id,
      movie_id: holding.movie_id,
      amount_paid: holding.amount_paid!,
      counterpicked_by_team_id: holding.counterpicked_by_team_id,
      movie: holdingMovie(holding),
    }))

  // Fetch profiles separately (no direct FK from league_participants)
  const userIds = (participants ?? []).map((p) => p.user_id)
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from('profiles').select('*').in('user_id', userIds)
      : { data: [] }

  // Build profile lookup map for O(1) access
  const profilesByUserId = new Map(
    (profiles ?? []).map((p) => [p.user_id, p])
  )

  // Merge profiles into participants
  const participantsWithProfiles = (participants ?? []).map((p) => ({
    ...p,
    profiles: profilesByUserId.get(p.user_id) ?? null,
  }))

  // The champion banner and the table read the same rows, so a name can never
  // disagree with the rank shown beside it.
  const rows = seasonStandings(typedLeague.final_standings, standings)
  const ownerNameByUserId = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, (p.display_name as string | null) ?? null])
  )
  const champions = resolveChampions(typedLeague.winner_team_ids, rows, ownerNameByUserId)

  return (
    <StandingsClient
      participants={participantsWithProfiles as ParticipantWithTeamScore[]}
      standings={rows}
      draftPicks={draftPicks}
      pickups={pickups}
      counterpicks={(counterpicks ?? []) as CounterpickWithScores[]}
      currentUserId={user.id}
      startingBudget={league.faab_budget ?? 0}
      seasonYear={typedLeague.season_year}
      isCompleted={typedLeague.status === 'completed'}
      champions={champions}
      reigningChampions={reigningChampions}
    />
  )
}
