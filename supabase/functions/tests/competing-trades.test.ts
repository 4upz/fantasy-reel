/**
 * Regression tests for competing trade offers (migration 20260809120000).
 *
 * Users could not propose a trade for a movie that another pending offer
 * already named. Two constraints caused it, and both are now gone:
 *   - validate_trade_movies_trigger, which rejected any overlap of movies
 *   - idx_unique_active_trade_between_teams, which allowed only one open offer
 *     per pair of teams
 *
 * What replaces them is late-bound validation: several offers may name the same
 * movie, execute_trade() re-checks ownership under a row lock so only the first
 * one transfers it, and every other open offer naming that movie is expired.
 *
 * These assertions deliberately go through the database (trade_offers inserts,
 * execute_trade, get_contested_source_ids) rather than the Edge Functions,
 * because the guarantee being tested lives in SQL -- the trigger is not there to
 * be re-added at the function layer.
 *
 * Requires: npx supabase start
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, uniqueName } from './_setup.ts'

interface TradeMovieRef {
  movie_id: string
  source: 'draft_pick'
  source_id: string
}

/** Shape execute_trade returns; invalidated_trades is always present. */
interface ExecuteTradeResult {
  success?: boolean
  error?: string
  invalidated_trades?: Array<{ id: string }>
}

Deno.test({
  name: 'competing trades (same movie in multiple offers)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    const leagueId = await factory.createTradingLeague(uniqueName('competing'), 3)

    // createActiveLeague runs a full draft, so every team already holds picks.
    const { data: participants } = await serviceClient
      .from('league_participants')
      .select('teams(id)')
      .eq('league_id', leagueId)
      .eq('status', 'active')

    const teamIds = (participants ?? [])
      .map((p) => (p.teams as unknown as { id: string } | null)?.id)
      .filter((id): id is string => Boolean(id))

    assertEquals(teamIds.length, 3, 'expected three teams in the trading league')
    const [teamA, teamB, teamC] = teamIds

    /** Two distinct holdings for a team, as trade item refs. */
    async function holdingsFor(teamId: string): Promise<TradeMovieRef[]> {
      const { data } = await serviceClient
        .from('draft_picks')
        .select('id, movie_id')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .is('dropped_at', null)
        .order('id')

      return (data ?? []).map((pick) => ({
        movie_id: pick.movie_id,
        source: 'draft_pick' as const,
        source_id: pick.id,
      }))
    }

    const aHoldings = await holdingsFor(teamA)
    const bHoldings = await holdingsFor(teamB)
    const cHoldings = await holdingsFor(teamC)

    // The same-pair case below needs a second distinct movie from A and B.
    assertEquals(aHoldings.length >= 2, true, 'team A needs two holdings')
    assertEquals(bHoldings.length >= 2, true, 'team B needs two holdings')
    assertEquals(cHoldings.length >= 1, true, 'team C needs a holding')

    const contestedMovie = aHoldings[0]

    async function proposeTrade(
      initiatorTeamId: string,
      recipientTeamId: string,
      initiatorMovies: TradeMovieRef[],
      recipientMovies: TradeMovieRef[]
    ): Promise<{ id?: string; error?: string }> {
      const { data, error } = await serviceClient
        .from('trade_offers')
        .insert({
          league_id: leagueId,
          initiator_team_id: initiatorTeamId,
          recipient_team_id: recipientTeamId,
          initiator_items: { movies: initiatorMovies, faab: 0 },
          recipient_items: { movies: recipientMovies, faab: 0 },
          status: 'proposed',
          proposed_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      return { id: data?.id, error: error?.message }
    }

    async function statusOf(tradeId: string): Promise<string | null> {
      const { data } = await serviceClient
        .from('trade_offers')
        .select('status')
        .eq('id', tradeId)
        .single()
      return data?.status ?? null
    }

    async function ownerOf(sourceId: string): Promise<string | null> {
      const { data } = await serviceClient
        .from('draft_picks')
        .select('team_id')
        .eq('id', sourceId)
        .single()
      return data?.team_id ?? null
    }

    let tradeAB = ''
    let tradeAC = ''
    let tradeABSecond = ''

    await t.step('a second offer may name a movie an open offer already wants', async () => {
      const first = await proposeTrade(teamA, teamB, [contestedMovie], [bHoldings[0]])
      assertEquals(first.error, undefined, 'first offer should insert cleanly')
      assertExists(first.id)
      tradeAB = first.id

      // Previously rejected by validate_trade_movies_trigger with
      // 'Movie ... is already in a pending trade'.
      const second = await proposeTrade(teamA, teamC, [contestedMovie], [cHoldings[0]])
      assertEquals(second.error, undefined, 'competing offer for the same movie must be allowed')
      assertExists(second.id)
      tradeAC = second.id
    })

    await t.step('two teams may have more than one open offer between them', async () => {
      // Previously rejected by idx_unique_active_trade_between_teams (23505).
      const result = await proposeTrade(teamA, teamB, [aHoldings[1]], [bHoldings[1]])
      assertEquals(result.error, undefined, 'a second offer to the same team must be allowed')
      assertExists(result.id)
      tradeABSecond = result.id
    })

    await t.step('the contested movie is reported as contested', async () => {
      const { data, error } = await serviceClient.rpc('get_contested_source_ids', {
        p_league_id: leagueId,
      })
      assertEquals(error, null)

      const row = (data ?? []).find(
        (r: { source_id: string }) => r.source_id === contestedMovie.source_id
      )
      assertExists(row, 'the doubly-claimed movie should be reported')
      assertEquals(Number(row.trade_count), 2)

      // The uncontested holdings must not be flagged.
      const uncontested = (data ?? []).find(
        (r: { source_id: string }) => r.source_id === aHoldings[1].source_id
      )
      assertEquals(uncontested, undefined, 'a singly-claimed movie is not contested')
    })

    await t.step('executing one offer expires only the offers that shared a movie', async () => {
      await serviceClient
        .from('trade_offers')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', tradeAB)

      const { data, error } = await serviceClient.rpc('execute_trade', { p_trade_id: tradeAB })
      assertEquals(error, null)

      const result = data as ExecuteTradeResult
      assertEquals(result.success, true, `execute_trade failed: ${result.error ?? 'unknown'}`)

      // The winner completed and actually moved the holding.
      assertEquals(await statusOf(tradeAB), 'completed')
      assertEquals(await ownerOf(contestedMovie.source_id), teamB)

      // The competing offer was expired and reported back for notification.
      const invalidatedIds = (result.invalidated_trades ?? []).map((tr) => tr.id)
      assertEquals(invalidatedIds.includes(tradeAC), true, 'competing offer should be reported')
      assertEquals(await statusOf(tradeAC), 'expired')

      // The same-pair offer shared no movie, so it is untouched.
      assertEquals(invalidatedIds.includes(tradeABSecond), false)
      assertEquals(await statusOf(tradeABSecond), 'proposed')
    })

    await t.step('the losing offer can no longer be executed', async () => {
      await serviceClient.from('trade_offers').update({ status: 'accepted' }).eq('id', tradeAC)

      const { data } = await serviceClient.rpc('execute_trade', { p_trade_id: tradeAC })
      const result = data as ExecuteTradeResult

      assertEquals(result.success, undefined, 'a stale offer must not execute')
      assertExists(result.error)
      assertEquals(
        result.error.includes('not owned'),
        true,
        `expected an ownership failure, got: ${result.error}`
      )
      // Team C never received anything.
      assertEquals(await ownerOf(contestedMovie.source_id), teamB)
    })

    await t.step('cleanup test data', async () => {
      await serviceClient.from('trade_offers').delete().eq('league_id', leagueId)
      await factory.cleanup()
    })
  },
})
