/**
 * Integration tests for start-next-season.
 *
 * Rollover copies the settings and the people forward and nothing else. The
 * assertions below are mostly about what does NOT come across: rosters, dates,
 * join codes, and the completed-season stamps.
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists, assertNotEquals } from '@std/assert'
import {
  createTestFactory,
  getAnonClient,
  getServiceClient,
  uniqueName,
  invokeFunction,
} from './_setup.ts'

interface SeasonResponse {
  league_id: string
  season_year: number
}

/** Move a league to its finished state, as `complete_league` would. */
async function completeLeague(leagueId: string): Promise<void> {
  const { error } = await getServiceClient()
    .from('leagues')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', leagueId)
  if (error) throw new Error(`Failed to complete league: ${error.message}`)
}

Deno.test({
  name: 'start-next-season',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()

    // ========================================================================
    // Authentication and validation
    // ========================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const result = await invokeFunction(getAnonClient(), 'start-next-season', {
        league_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'Unauthorized')
    })

    await t.step('returns 400 for a malformed league_id', async () => {
      const result = await invokeFunction(client, 'start-next-season', {
        league_id: 'not-a-uuid',
      })
      assertEquals(result.error, 'Valid league_id is required')
      assertEquals(result.status, 400)
    })

    await t.step('returns 404 for a league that does not exist', async () => {
      const result = await invokeFunction(client, 'start-next-season', {
        league_id: '00000000-0000-0000-0000-000000000000',
      })
      assertEquals(result.error, 'League not found')
      assertEquals(result.status, 404)
    })

    // ========================================================================
    // Authorization and state
    // ========================================================================

    await t.step('returns 403 for someone who is not the commissioner', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('rollover-403'))
      await completeLeague(leagueId)

      const result = await invokeFunction(secondClient, 'start-next-season', {
        league_id: leagueId,
      })
      assertEquals(result.error, 'Only the league commissioner can start the next season')
      assertEquals(result.status, 403)
    })

    await t.step('returns 400 while the season is still running', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('rollover-active'))

      const result = await invokeFunction(client, 'start-next-season', {
        league_id: leagueId,
      })
      assertEquals(
        result.error,
        'The current season has to finish before the next one can start'
      )
      assertEquals(result.status, 400)
    })

    // ========================================================================
    // The rollover itself
    // ========================================================================

    await t.step('opens the next season with the settings and people carried over', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('rollover-ok'))

      // A distinctive settings fingerprint, so "copied" means copied rather
      // than "happens to match the column defaults".
      await serviceClient
        .from('leagues')
        .update({
          total_slots: 11,
          draft_slots: 7,
          drop_limit: 4,
          faab_budget: 250,
          new_bid_cutoff_hours: 12,
          trades_enabled: false,
          trade_review_enabled: false,
          trade_veto_hours: 48,
          draft_counterpick_slots: 3,
          bidding_counterpick_slots: 2,
          counterpicks_block_drops: false,
          invite_only: true,
          max_participants: 12,
          join_code: 'ZZZ999',
          custom_draft_order: true,
          trade_deadline: '2026-11-01',
        })
        .eq('id', leagueId)

      const { data: before } = await serviceClient
        .from('leagues')
        .select('*')
        .eq('id', leagueId)
        .single()

      // A Discord channel on the old season, to check where it ends up.
      const channelId = `chan-${crypto.randomUUID()}`
      await serviceClient.from('discord_channels').insert({
        league_id: leagueId,
        guild_id: 'guild-rollover-test',
        channel_id: channelId,
        webhook_id: 'wh-rollover-test',
        webhook_url: 'https://discord.com/api/webhooks/rollover/test',
        notify_trades: false,
      })

      await completeLeague(leagueId)

      const result = await invokeFunction<SeasonResponse>(client, 'start-next-season', {
        league_id: leagueId,
      })

      assertEquals(result.error, null)
      const newLeagueId = result.data!.league_id
      factory.trackLeague(newLeagueId)

      assertEquals(result.data!.season_year, before!.season_year + 1)
      assertNotEquals(newLeagueId, leagueId)

      const { data: next } = await serviceClient
        .from('leagues')
        .select('*')
        .eq('id', newLeagueId)
        .single()

      // Same league, next season.
      assertEquals(next!.series_id, before!.series_id)
      assertEquals(next!.name, before!.name)
      assertEquals(next!.owner_id, before!.owner_id)
      assertEquals(next!.season_year, before!.season_year + 1)
      assertEquals(next!.season_end, `${before!.season_year + 1}-12-31`)

      // Settings carried over.
      assertEquals(next!.total_slots, 11)
      assertEquals(next!.draft_slots, 7)
      assertEquals(next!.drop_limit, 4)
      assertEquals(next!.faab_budget, 250)
      assertEquals(next!.new_bid_cutoff_hours, 12)
      assertEquals(next!.trades_enabled, false)
      assertEquals(next!.trade_review_enabled, false)
      assertEquals(next!.trade_veto_hours, 48)
      assertEquals(next!.draft_counterpick_slots, 3)
      assertEquals(next!.bidding_counterpick_slots, 2)
      assertEquals(next!.counterpicks_block_drops, false)
      assertEquals(next!.invite_only, true)
      assertEquals(next!.max_participants, 12)

      // Reset: nothing has happened in the new season yet.
      assertEquals(next!.status, 'setup')
      assertEquals(next!.completed_at, null)
      assertEquals(next!.winner_team_ids, null)
      assertEquals(next!.draft_start_date, null)
      assertEquals(next!.draft_end_date, null)
      assertEquals(next!.trade_deadline, null)
      assertEquals(next!.custom_draft_order, false)
      // Last season's join code must not admit anyone to this one.
      assertEquals(next!.join_code, null)
      assertEquals(next!.join_token, null)

      // The people came, with their team names, and no draft order yet.
      const { data: participants } = await serviceClient
        .from('league_participants')
        .select('user_id, role, status, draft_order, teams(name)')
        .eq('league_id', newLeagueId)

      assertEquals(participants!.length, 2)
      assertEquals(participants!.every((p) => p.status === 'active'), true)
      assertEquals(participants!.every((p) => p.draft_order === null), true)
      assertEquals(participants!.filter((p) => p.role === 'owner').length, 1)
      assertEquals(participants!.every((p) => p.teams != null), true)

      const { data: oldTeamNames } = await serviceClient
        .from('league_participants')
        .select('teams(name)')
        .eq('league_id', leagueId)

      const nameOf = (rows: unknown[]) =>
        rows
          .map((r) => (r as { teams: { name: string } | null }).teams?.name)
          .filter(Boolean)
          .sort()
      assertEquals(nameOf(participants!), nameOf(oldTeamNames!))

      // Nothing anybody owned came with them.
      const { count: holdingCount } = await serviceClient
        .from('team_holdings')
        .select('holding_id', { count: 'exact', head: true })
        .eq('league_id', newLeagueId)
      assertEquals(holdingCount, 0)

      // The old season is untouched -- last year stays browsable.
      const { count: oldHoldingCount } = await serviceClient
        .from('team_holdings')
        .select('holding_id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
      assertEquals(oldHoldingCount! > 0, true)

      // The Discord channel MOVED rather than being copied: channel_id is
      // unique, so one channel maps to exactly one league.
      const { data: channels } = await serviceClient
        .from('discord_channels')
        .select('league_id, notify_trades')
        .eq('channel_id', channelId)

      assertEquals(channels!.length, 1)
      assertEquals(channels![0].league_id, newLeagueId)
      assertEquals(channels![0].notify_trades, false, 'toggles ride along')

      // Everyone was told.
      const { data: notifications } = await serviceClient
        .from('notifications')
        .select('user_id, type, title')
        .eq('league_id', newLeagueId)
        .eq('type', 'season_started')

      assertEquals(notifications!.length, 2)
      assertExists(notifications![0].title)

      // ----------------------------------------------------------------
      // A second click must not open a third season.
      // ----------------------------------------------------------------
      const again = await invokeFunction(client, 'start-next-season', {
        league_id: leagueId,
      })
      assertEquals(again.status, 409)
      assertEquals(
        again.error,
        `The ${before!.season_year + 1} season has already been started`
      )
    })

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
