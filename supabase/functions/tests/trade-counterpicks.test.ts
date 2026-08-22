/**
 * Trading counterpicks (migration 20260822120000).
 *
 * A counterpick is an asset a team owns -- an inverted bet worth real points --
 * and it is now tradeable like any roster holding, with source 'counterpick'
 * and source_id = counterpicks.id.
 *
 * These assertions go through the database (trade_offers inserts,
 * validate_trade_items, execute_trade) rather than the Edge Functions, because
 * everything under test lives in SQL: the ownership re-check under the trade
 * row lock, the invariant that no team may finish a trade holding both a movie
 * and the bet against it, and the bookkeeping that has to move with a
 * counterpick (the denormalized counterpicked_by_team_id, trade_assets, and
 * both teams' scores).
 *
 * Requires: npx supabase start
 */

import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getServiceClient, uniqueName } from './_setup.ts'

interface TradeItemRef {
  movie_id: string
  source: 'draft_pick' | 'pickup' | 'counterpick'
  source_id: string
}

interface ExecuteTradeResult {
  success?: boolean
  error?: string
}

Deno.test({
  name: 'trading counterpicks',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    const leagueId = await factory.createTradingLeague(uniqueName('cp-trade'), 3)

    // Counterpicks are per-phase capacity; give the league room for the
    // scenarios below so the slot cap is not what is under test here.
    await serviceClient
      .from('leagues')
      .update({ draft_counterpick_slots: 3, trade_review_enabled: false })
      .eq('id', leagueId)

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

    async function holdingsFor(teamId: string): Promise<TradeItemRef[]> {
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

    /** Seed an awarded counterpick, exactly as make-counterpick records one. */
    async function seedCounterpick(
      counterpickerTeamId: string,
      holding: TradeItemRef
    ): Promise<TradeItemRef> {
      const { data: pick } = await serviceClient
        .from('draft_picks')
        .select('team_id')
        .eq('id', holding.source_id)
        .single()

      const { data: existing } = await serviceClient
        .from('counterpicks')
        .select('pick_order')
        .eq('league_id', leagueId)
        .order('pick_order', { ascending: false })
        .limit(1)

      const { data: counterpick, error } = await serviceClient
        .from('counterpicks')
        .insert({
          league_id: leagueId,
          counterpicker_team_id: counterpickerTeamId,
          target_team_id: pick!.team_id,
          movie_id: holding.movie_id,
          draft_pick_id: holding.source_id,
          pick_order: (existing?.[0]?.pick_order ?? 0) + 1,
          phase: 'draft',
        })
        .select('id')
        .single()

      if (error || !counterpick) throw new Error(`seedCounterpick failed: ${error?.message}`)

      await serviceClient
        .from('draft_picks')
        .update({ counterpicked_by_team_id: counterpickerTeamId })
        .eq('id', holding.source_id)

      return {
        movie_id: holding.movie_id,
        source: 'counterpick' as const,
        source_id: counterpick.id,
      }
    }

    async function proposeAndAccept(
      initiatorTeamId: string,
      recipientTeamId: string,
      initiatorItems: TradeItemRef[],
      recipientItems: TradeItemRef[]
    ): Promise<string> {
      const { data, error } = await serviceClient
        .from('trade_offers')
        .insert({
          league_id: leagueId,
          initiator_team_id: initiatorTeamId,
          recipient_team_id: recipientTeamId,
          initiator_items: { movies: initiatorItems, faab: 0 },
          recipient_items: { movies: recipientItems, faab: 0 },
          status: 'accepted',
          proposed_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error || !data) throw new Error(`proposeAndAccept failed: ${error?.message}`)
      return data.id
    }

    async function execute(tradeId: string): Promise<ExecuteTradeResult> {
      const { data, error } = await serviceClient.rpc('execute_trade', { p_trade_id: tradeId })
      assertEquals(error, null)
      return data as ExecuteTradeResult
    }

    async function counterpickerOf(counterpickId: string): Promise<string | null> {
      const { data } = await serviceClient
        .from('counterpicks')
        .select('counterpicker_team_id')
        .eq('id', counterpickId)
        .single()
      return data?.counterpicker_team_id ?? null
    }

    const aHoldings = await holdingsFor(teamA)
    const bHoldings = await holdingsFor(teamB)
    const cHoldings = await holdingsFor(teamC)

    assertEquals(aHoldings.length >= 2, true, 'team A needs two holdings')
    assertEquals(bHoldings.length >= 1, true, 'team B needs a holding')
    assertEquals(cHoldings.length >= 2, true, 'team C needs two holdings')

    await t.step('validate_trade_items accepts a counterpick its owner holds', async () => {
      const counterpick = await seedCounterpick(teamA, cHoldings[0])

      const { data, error } = await serviceClient.rpc('validate_trade_items', {
        p_team_id: teamA,
        p_items: { movies: [counterpick], faab: 0 },
      })
      assertEquals(error, null)
      assertEquals(data, null, 'a counterpick the team owns must validate')

      // ...and rejects it for anyone else, which is what stops two competing
      // offers from both transferring it.
      const { data: wrongTeam } = await serviceClient.rpc('validate_trade_items', {
        p_team_id: teamB,
        p_items: { movies: [counterpick], faab: 0 },
      })
      assertEquals(wrongTeam, `Counterpick not owned: ${counterpick.source_id}`)
    })

    await t.step('a counterpick changes hands, with its bookkeeping', async () => {
      // Team A bets against one of team C's movies, then trades that bet to B.
      const counterpick = await seedCounterpick(teamA, cHoldings[1])

      const before = await serviceClient
        .from('team_scores')
        .select('counterpick_points')
        .eq('team_id', teamB)
        .maybeSingle()

      const tradeId = await proposeAndAccept(teamA, teamB, [counterpick], [bHoldings[0]])
      const result = await execute(tradeId)
      assertEquals(result.success, true, `execute_trade failed: ${result.error ?? 'unknown'}`)

      assertEquals(await counterpickerOf(counterpick.source_id), teamB, 'the bet moved to B')

      // The denormalized copy the drop rules read must move with it, or the
      // wrong team is told it owns the block.
      const { data: pick } = await serviceClient
        .from('draft_picks')
        .select('counterpicked_by_team_id, team_id')
        .eq('id', cHoldings[1].source_id)
        .single()
      assertEquals(pick?.counterpicked_by_team_id, teamB)
      assertEquals(pick?.team_id, teamC, 'the counterpicked movie itself did not move')

      // The transfer is recorded as its own asset kind.
      const { data: asset } = await serviceClient
        .from('trade_assets')
        .select('from_team_id, to_team_id, counterpick_id')
        .eq('trade_offer_id', tradeId)
        .eq('counterpick_id', counterpick.source_id)
        .single()
      assertExists(asset, 'the counterpick transfer should be recorded in trade_assets')
      assertEquals(asset?.from_team_id, teamA)
      assertEquals(asset?.to_team_id, teamB)

      // Both teams are rescored: counterpick_points moved between them.
      const { data: after } = await serviceClient
        .from('team_scores')
        .select('counterpicks_made, last_calculated_at')
        .eq('team_id', teamB)
        .single()
      assertExists(after, 'team B should have a score row after the trade')
      assertEquals(
        (after?.counterpicks_made ?? 0) > 0,
        true,
        `team B should now own a counterpick (was ${before.data?.counterpick_points ?? 0} pts)`
      )
    })

    await t.step('a counterpick may not be sent to the team holding the movie', async () => {
      // A bets against B's movie, then tries to hand that bet to B -- which
      // would make B its own target.
      const counterpick = await seedCounterpick(teamA, bHoldings[1] ?? bHoldings[0])

      const tradeId = await proposeAndAccept(teamA, teamB, [counterpick], [])
      const result = await execute(tradeId)

      assertEquals(result.success, undefined)
      assertEquals(
        result.error,
        `Cannot trade a counterpick to the team that holds the counterpicked movie: ${counterpick.source_id}`
      )

      // A rejection must leave the trade completely untouched.
      assertEquals(await counterpickerOf(counterpick.source_id), teamA)
      const { data: trade } = await serviceClient
        .from('trade_offers')
        .select('status')
        .eq('id', tradeId)
        .single()
      assertEquals(trade?.status, 'accepted', 'the refused trade must not be marked completed')
    })

    await t.step('a movie and the counterpick on it may swap sides in one trade', async () => {
      // The case a current-ownership check would wrongly refuse: A holds the
      // movie, C holds the bet against it, and they exchange roles. Neither
      // ends up on both sides, so the invariant holds -- but only if the guard
      // reasons about post-trade ownership and the holding moves first.
      const holding = aHoldings[1]
      const counterpick = await seedCounterpick(teamC, holding)

      const tradeId = await proposeAndAccept(teamA, teamC, [holding], [counterpick])
      const result = await execute(tradeId)
      assertEquals(result.success, true, `execute_trade failed: ${result.error ?? 'unknown'}`)

      const { data: pick } = await serviceClient
        .from('draft_picks')
        .select('team_id, counterpicked_by_team_id')
        .eq('id', holding.source_id)
        .single()
      assertEquals(pick?.team_id, teamC, 'the movie went to C')
      assertEquals(pick?.counterpicked_by_team_id, teamA, 'the bet against it went to A')

      const { data: row } = await serviceClient
        .from('counterpicks')
        .select('counterpicker_team_id, target_team_id')
        .eq('id', counterpick.source_id)
        .single()
      assertEquals(row?.counterpicker_team_id, teamA)
      assertEquals(row?.target_team_id, teamC, 'target follows the movie to its new holder')
    })
  },
})
