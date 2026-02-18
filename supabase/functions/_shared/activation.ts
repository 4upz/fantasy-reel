import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function activateLeague(
  serviceClient: SupabaseClient,
  leagueId: string,
  currentStatus: string,
): Promise<{ error?: string }> {
  // Update league status to 'active' with check-and-set
  const { data: updated, error: statusError } = await serviceClient
    .from('leagues')
    .update({ status: 'active' })
    .eq('id', leagueId)
    .eq('status', currentStatus)
    .select('id')
    .single()

  if (statusError?.code === 'PGRST116' || !updated) {
    return { error: 'League status has already changed' }
  }

  if (statusError) {
    console.error('Failed to update league status:', statusError)
    return { error: 'Failed to activate league' }
  }

  // Initialize team budgets for bidding
  const { error: budgetError } = await serviceClient.rpc('initialize_team_budgets', { p_league_id: leagueId })
  if (budgetError) {
    console.error('Failed to initialize team budgets:', budgetError)
  }

  // Create team_scores for all teams in the league
  const { data: participants } = await serviceClient
    .from('league_participants')
    .select('id')
    .eq('league_id', leagueId)

  const participantIds = participants?.map(p => p.id) || []

  const { data: teams } = participantIds.length > 0
    ? await serviceClient
        .from('teams')
        .select('id')
        .in('participant_id', participantIds)
    : { data: [] }

  if (teams && teams.length > 0) {
    const teamScores = teams.map(t => ({
      team_id: t.id,
      total_points: 0,
      draft_points: 0,
      counterpick_points: 0,
      movies_scored: 0,
      movies_pending: 0,
      counterpicks_made: 0,
      counterpicks_scored: 0,
    }))

    const { error: scoresError } = await serviceClient
      .from('team_scores')
      .upsert(teamScores, { onConflict: 'team_id' })

    if (scoresError) {
      console.error('Failed to initialize team scores:', scoresError)
    }
  }

  return {}
}
