/**
 * Integration tests for process-bids Edge Function
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient, createTestFactory, uniqueName, getUserId } from './_setup.ts'

/**
 * Generate a tmdb_id well outside both the real TMDb ID range and the shared
 * draft-movie pool (factory picks start at 900_100_001 and increment - see
 * createActiveLeague). Tests that mutate a movie's release_date must use an
 * id nobody else touches, or they corrupt the shared pool for every other
 * integration test that drafts afterward.
 */
function uniqueVoidTestTmdbId(): number {
  return 950_000_000 + Math.floor(Math.random() * 1_000_000)
}

/**
 * Seed a normal, unrelated pickup bid that will win cleanly when process-bids
 * runs. process-bids' weekly mode only fetches counterpick bids at all if
 * `pickup_bids` has at least one row due for processing (a pre-existing gap,
 * not introduced by this task - see task-3-report.md); tests exercising
 * counterpick-only scenarios need a decoy pickup bid in the same league to
 * reach the counterpick code path at all.
 */
async function seedDecoyPickupBid(
  serviceClient: SupabaseClient,
  leagueId: string,
  teamId: string,
): Promise<void> {
  const tmdbId = uniqueVoidTestTmdbId()
  await serviceClient.from('pickup_bids').insert({
    league_id: leagueId,
    team_id: teamId,
    tmdb_id: tmdbId,
    movie_data: { title: `Decoy Movie ${tmdbId}`, release_date: '2099-01-01', vote_average: 5, popularity: 10 },
    amount: 1,
    status: 'active',
    processing_deadline: new Date(Date.now() - 60_000).toISOString(),
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'

/**
 * The `supabase start` edge runtime serves the *main checkout's* functions, so a
 * worktree change is only exercised by pointing PROCESS_BIDS_URL at a standalone
 * `deno run process-bids/index.ts` (which binds :8000). That process takes its
 * service role key from .env.test rather than the container's environment.
 */
const STANDALONE_URL = Deno.env.get('PROCESS_BIDS_URL')
const FUNCTION_URL = STANDALONE_URL || `${SUPABASE_URL}/functions/v1/process-bids`

/**
 * Host the function should call back on to reach a server this test started.
 * `host.docker.internal` is how the containerised edge runtime reaches the host,
 * and it does not resolve from the host itself -- so a standalone run needs
 * loopback instead.
 */
const CALLBACK_HOST = STANDALONE_URL ? '127.0.0.1' : 'host.docker.internal'

/**
 * Get the service role key that the Edge Function runtime actually uses.
 */
async function getEdgeFunctionServiceRoleKey(): Promise<string> {
  try {
    const cmd = new Deno.Command('docker', {
      args: ['exec', 'supabase_edge_runtime_fantasy-reel', 'printenv', 'SUPABASE_SERVICE_ROLE_KEY'],
      stdout: 'piped',
      stderr: 'piped',
    })
    const output = await cmd.output()
    if (output.success) {
      const key = new TextDecoder().decode(output.stdout).trim()
      if (key) return key
    }
  } catch {
    // Docker not available or container not found
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

Deno.test({
  name: 'process-bids',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()
    const serviceClient = getServiceClient()
    const SERVICE_ROLE_KEY = STANDALONE_URL
      ? (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      : await getEdgeFunctionServiceRoleKey()

    async function callProcessBids(body?: Record<string, unknown>) {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      try {
        const data = JSON.parse(text)
        return { status: response.status, data }
      } catch {
        return { status: response.status, text }
      }
    }

    try {
      // Clear out any existing active bids to ensure a clean starting state
      await serviceClient
        .from('pickup_bids')
        .update({ status: 'lost' })
        .eq('status', 'active')

      await serviceClient
        .from('counterpick_bids')
        .update({ status: 'lost' })
        .eq('status', 'active')

      // ============================================================================
      // Authentication & Basic Tests
      // ============================================================================

      await t.step('returns 403 when no auth headers provided', async () => {
        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        assertEquals(response.status, 403)
        const data = await response.json()
        assertEquals(data.error, 'Forbidden')
      })

      await t.step('returns empty results when no bids exist', async () => {
        const { status, data } = await callProcessBids({ mode: 'weekly' })
        assertEquals(status, 200)
        assertEquals(data.processed, 0)
        assertEquals(data.message, 'No bids to process')
      })

      // ============================================================================
      // Bidding Concluded ("No Bids") Notification Tests
      // ============================================================================

      await t.step('sends "no bids concluded" Discord notification on weekly run', async () => {
        // Create a test league
        const leagueName = uniqueName('nb-league')
        const { id: leagueId } = await factory.createLeague(leagueName)

        // Set up a mock local server to receive the Discord webhook POST request
        let receivedPayload: any = null
        const server = Deno.serve({ port: 0, hostname: '0.0.0.0' }, async (req) => {
          try {
            receivedPayload = await req.json()
          } catch {
            // Ignore
          }
          return new Response(null, { status: 204 })
        })

        const localPort = server.addr.port
        const mockWebhookUrl = `http://${CALLBACK_HOST}:${localPort}/webhook`

        try {
          // Insert a mock channel linked to the league
          const { error: channelError } = await serviceClient
            .from('discord_channels')
            .insert({
              league_id: leagueId,
              guild_id: 'test-guild-nb',
              channel_id: uniqueName('ch-nb'),
              webhook_id: 'webhook-nb',
              webhook_url: mockWebhookUrl,
              notify_bids: true,
              enabled: true,
            })

          assertEquals(channelError, null)

          // Invoke process-bids in weekly mode
          const { status, data } = await callProcessBids({ mode: 'weekly' })
          console.log('[TEST DEBUG] callProcessBids response:', data)

          const { data: dbChannels } = await serviceClient
            .from('discord_channels')
            .select('*')
          console.log('[TEST DEBUG] discord_channels currently in DB:', dbChannels)

          assertEquals(status, 200)
          assertEquals(data.processed, 0)

          // Give a short delay to let the async notification fetch resolve
          await new Promise((resolve) => setTimeout(resolve, 500))

          // Verify the local server received the webhook request with correct payload
          console.log('[TEST DEBUG] receivedPayload:', receivedPayload)
          assertExists(receivedPayload)
          assertEquals(receivedPayload.username, 'Fantasy Reel')
          assertExists(receivedPayload.embeds)
          assertEquals(receivedPayload.embeds.length, 1)
          
          const embed = receivedPayload.embeds[0]
          assertEquals(embed.title, 'Bidding Results')
          assertEquals(embed.description, 'Bidding has concluded for this week. No bids were placed.')
          assertEquals(embed.author?.name, leagueName)
        } finally {
          await server.shutdown()
        }
      })

      await t.step('awards a pickup to the highest bidder and charges its budget', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('pu-award'), 2)
        const team = await factory.getTeamForUser(leagueId, client)
        const teamId = team!.teamId

        const { data: budgetBefore } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', teamId)
          .single()

        const tmdbId = 900_800_001 + Math.floor(Math.random() * 100_000)
        const { error: bidError } = await serviceClient.from('pickup_bids').insert({
          league_id: leagueId,
          team_id: teamId,
          tmdb_id: tmdbId,
          movie_data: {
            title: 'Pickup Award Test',
            poster_url: null,
            release_date: `${new Date().getFullYear() + 1}-12-15`,
            vote_average: 6,
            popularity: 20,
          },
          amount: 7,
          status: 'active',
          processing_deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        })
        assertEquals(bidError, null)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertEquals(data.processed, 1)
        assertEquals(data.results[0].winner_team_id, teamId)

        const { data: pickup } = await serviceClient
          .from('pickups')
          .select('team_id, amount_paid')
          .eq('league_id', leagueId)
          .maybeSingle()
        assertExists(pickup)
        assertEquals(pickup.team_id, teamId)
        assertEquals(pickup.amount_paid, 7)

        const { data: budgetAfter } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', teamId)
          .single()
        assertEquals(budgetAfter!.remaining_budget, budgetBefore!.remaining_budget - 7)

        // The winner is notified; this also covers the shared notification helpers.
        const { count: wonNotifications } = await serviceClient
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('type', 'bid_won')
        assertEquals(wonNotifications, 1)
      })

      await t.step('does NOT send "no bids" Discord notification on extended run', async () => {
        const leagueName = uniqueName('nb-ext-league')
        const { id: leagueId } = await factory.createLeague(leagueName)

        let receivedPayload: any = null
        const server = Deno.serve({ port: 0, hostname: '0.0.0.0' }, async (req) => {
          try {
            receivedPayload = await req.json()
          } catch {
            // Ignore
          }
          return new Response(null, { status: 204 })
        })

        const localPort = server.addr.port
        const mockWebhookUrl = `http://${CALLBACK_HOST}:${localPort}/webhook`

        try {
          const { error: channelError } = await serviceClient
            .from('discord_channels')
            .insert({
              league_id: leagueId,
              guild_id: 'test-guild-nb-ext',
              channel_id: uniqueName('ch-nb-ext'),
              webhook_id: 'webhook-nb-ext',
              webhook_url: mockWebhookUrl,
              notify_bids: true,
              enabled: true,
            })

          assertEquals(channelError, null)

          // Invoke process-bids in extended mode
          const { status, data } = await callProcessBids({ mode: 'extended' })
          assertEquals(status, 200)

          // Give a short delay
          await new Promise((resolve) => setTimeout(resolve, 500))

          // Webhook should NOT have been called
          assertEquals(receivedPayload, null)
        } finally {
          await server.shutdown()
        }
      })

      // ============================================================================
      // Release-Date Revalidation at Processing Time (3a-3d)
      //
      // Bids can sit pending for up to a week (get_next_processing_deadline),
      // so a movie that was upcoming when a bid was placed may have released
      // by the time process-bids resolves it. These tests simulate that by
      // inserting a bid against a still-upcoming movie, then flipping the
      // movie's release_date to the past before invoking process-bids - the
      // same shape a forged client-supplied release date would take, since by
      // processing time the real movies row is authoritative.
      //
      // Each test uses a tmdb_id from uniqueVoidTestTmdbId(), never a shared
      // draft-pool movie, since mutating a pool movie's release_date would
      // break every other integration test that drafts afterward.
      // ============================================================================

      await t.step('cancels a pickup bid on a movie that released before processing (3a, 3d)', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('void-pickup-league'), 2)
        const myTeam = await factory.getTeamForUser(leagueId, client)
        if (!myTeam) throw new Error('Team not found')

        const tmdbId = uniqueVoidTestTmdbId()
        const movieTitle = `Void Test Movie ${tmdbId}`

        const { data: movieRow, error: movieInsertError } = await serviceClient
          .from('movies')
          .insert({
            tmdb_id: tmdbId,
            title: movieTitle,
            overview: 'Test movie for release-date revalidation',
            poster_url: null,
            release_date: '2099-01-01',
            vote_average: 5,
            popularity: 10,
            status: 'upcoming',
          })
          .select('id')
          .single()

        assertEquals(movieInsertError, null)
        assertExists(movieRow)

        const { data: budgetBefore } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', myTeam.teamId)
          .single()

        const { data: bidRow, error: bidInsertError } = await serviceClient
          .from('pickup_bids')
          .insert({
            league_id: leagueId,
            team_id: myTeam.teamId,
            tmdb_id: tmdbId,
            movie_data: { title: movieTitle, release_date: '2099-01-01', vote_average: 5, popularity: 10 },
            amount: 12,
            status: 'active',
            processing_deadline: new Date(Date.now() - 60_000).toISOString(),
          })
          .select('id')
          .single()

        assertEquals(bidInsertError, null)
        assertExists(bidRow)

        // Simulate the movie releasing after the bid was placed but before processing ran
        await serviceClient.from('movies').update({ release_date: '2020-01-01' }).eq('id', movieRow!.id)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertEquals(data.processed, 0)
        assertExists(data.voided_pickup_bids)
        assertEquals(data.voided_pickup_bids.length, 1)
        assertEquals(data.voided_pickup_bids[0].bid_id, bidRow!.id)
        assertEquals(data.voided_pickup_bids[0].movie_title, movieTitle)

        const { data: bidAfter } = await serviceClient
          .from('pickup_bids')
          .select('status')
          .eq('id', bidRow!.id)
          .single()
        assertEquals(bidAfter?.status, 'cancelled')

        const { data: pickupAfter } = await serviceClient
          .from('pickups')
          .select('id')
          .eq('bid_id', bidRow!.id)
          .maybeSingle()
        assertEquals(pickupAfter, null)

        const { data: budgetAfter } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', myTeam.teamId)
          .single()
        assertEquals(budgetAfter?.remaining_budget, budgetBefore?.remaining_budget)

        const bidderUserId = await getUserId(client)
        const { data: notification } = await serviceClient
          .from('notifications')
          .select('title, body, type, data')
          .eq('user_id', bidderUserId)
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        assertExists(notification)
        assertEquals(notification?.type, 'bid_lost')
        assertEquals((notification?.data as Record<string, unknown>)?.bid_id, bidRow!.id)
        assertEquals((notification?.data as Record<string, unknown>)?.reason, 'movie_released')
      })

      await t.step('cancels every pickup bid on a movie, not just the winner, when it released before processing', async () => {
        // Regression test: voiding only the winning bid left every other bid on
        // the same released movie stuck at status='active' forever (they'd only
        // ever surface again if some future run re-selected one of them as the
        // new "winner" and voided it too, draining the group one bid per week).
        // Both the would-be winner and the loser must be cancelled and notified
        // in the same processing run.
        const leagueId = await factory.createActiveLeague(uniqueName('void-multi-league'), 2)
        const winnerTeam = await factory.getTeamForUser(leagueId, client)
        const loserTeam = await factory.getTeamForUser(leagueId, secondClient)
        if (!winnerTeam || !loserTeam) throw new Error('Team not found')

        const tmdbId = uniqueVoidTestTmdbId()
        const movieTitle = `Void Multi Test Movie ${tmdbId}`

        const { data: movieRow, error: movieInsertError } = await serviceClient
          .from('movies')
          .insert({
            tmdb_id: tmdbId,
            title: movieTitle,
            overview: 'Test movie for multi-bid release-date revalidation',
            poster_url: null,
            release_date: '2099-01-01',
            vote_average: 5,
            popularity: 10,
            status: 'upcoming',
          })
          .select('id')
          .single()

        assertEquals(movieInsertError, null)
        assertExists(movieRow)

        const movieData = { title: movieTitle, release_date: '2099-01-01', vote_average: 5, popularity: 10 }

        // Higher bid would win if the movie hadn't released
        const { data: winnerBidRow, error: winnerBidError } = await serviceClient
          .from('pickup_bids')
          .insert({
            league_id: leagueId,
            team_id: winnerTeam.teamId,
            tmdb_id: tmdbId,
            movie_data: movieData,
            amount: 12,
            status: 'active',
            processing_deadline: new Date(Date.now() - 60_000).toISOString(),
          })
          .select('id')
          .single()
        assertEquals(winnerBidError, null)
        assertExists(winnerBidRow)

        // Lower bid would lose to the one above if the movie hadn't released
        const { data: loserBidRow, error: loserBidError } = await serviceClient
          .from('pickup_bids')
          .insert({
            league_id: leagueId,
            team_id: loserTeam.teamId,
            tmdb_id: tmdbId,
            movie_data: movieData,
            amount: 8,
            status: 'active',
            processing_deadline: new Date(Date.now() - 60_000).toISOString(),
          })
          .select('id')
          .single()
        assertEquals(loserBidError, null)
        assertExists(loserBidRow)

        const { data: loserBudgetBefore } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', loserTeam.teamId)
          .single()

        // Simulate the movie releasing after both bids were placed but before processing ran
        await serviceClient.from('movies').update({ release_date: '2020-01-01' }).eq('id', movieRow!.id)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertEquals(data.processed, 0)
        assertExists(data.voided_pickup_bids)
        assertEquals(data.voided_pickup_bids.length, 2)

        const voidedBidIds = data.voided_pickup_bids.map((v: { bid_id: string }) => v.bid_id).sort()
        assertEquals(voidedBidIds, [winnerBidRow!.id, loserBidRow!.id].sort())

        const { data: bidsAfter } = await serviceClient
          .from('pickup_bids')
          .select('id, status')
          .in('id', [winnerBidRow!.id, loserBidRow!.id])

        for (const bid of bidsAfter ?? []) {
          assertEquals(bid.status, 'cancelled')
        }

        // The loser's budget must be untouched - it was never a winner, so no
        // charge should ever have applied to it in the first place.
        const { data: loserBudgetAfter } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', loserTeam.teamId)
          .single()
        assertEquals(loserBudgetAfter?.remaining_budget, loserBudgetBefore?.remaining_budget)

        const loserUserId = await getUserId(secondClient)
        const { data: loserNotification } = await serviceClient
          .from('notifications')
          .select('type, data')
          .eq('user_id', loserUserId)
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        assertExists(loserNotification)
        assertEquals(loserNotification?.type, 'bid_lost')
        assertEquals((loserNotification?.data as Record<string, unknown>)?.bid_id, loserBidRow!.id)
        assertEquals((loserNotification?.data as Record<string, unknown>)?.reason, 'movie_released')
      })

      await t.step('cancels a counterpick bid on a movie that released before processing (3b, 3d)', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('void-cp-league'), 2)
        await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

        const targetTeam = await factory.getTeamForUser(leagueId, secondClient)
        const bidderTeam = await factory.getTeamForUser(leagueId, client)
        if (!targetTeam || !bidderTeam) throw new Error('Team not found')

        // See seedDecoyPickupBid: without a pending pickup bid in this league,
        // process-bids short-circuits before it ever looks at counterpick_bids.
        await seedDecoyPickupBid(serviceClient, leagueId, targetTeam.teamId)

        const tmdbId = uniqueVoidTestTmdbId()
        const movieTitle = `Void CP Test Movie ${tmdbId}`

        const draftPickId = await factory.createDraftPickForUser(leagueId, secondClient, {
          tmdb_id: tmdbId,
          title: movieTitle,
          release_date: '2099-01-01',
        })

        const { data: draftPick } = await serviceClient
          .from('draft_picks')
          .select('movie_id')
          .eq('id', draftPickId)
          .single()
        assertExists(draftPick)

        const { data: budgetBefore } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', bidderTeam.teamId)
          .single()

        const { data: bidRow, error: bidInsertError } = await serviceClient
          .from('counterpick_bids')
          .insert({
            league_id: leagueId,
            team_id: bidderTeam.teamId,
            movie_id: draftPick!.movie_id,
            target_team_id: targetTeam.teamId,
            draft_pick_id: draftPickId,
            amount: 7,
            status: 'active',
            processing_deadline: new Date(Date.now() - 60_000).toISOString(),
          })
          .select('id')
          .single()

        assertEquals(bidInsertError, null)
        assertExists(bidRow)

        // Simulate the movie releasing after the bid was placed but before processing ran
        await serviceClient.from('movies').update({ release_date: '2020-01-01' }).eq('id', draftPick!.movie_id)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertEquals(data.counterpick_processed, 0)
        assertExists(data.voided_counterpick_bids)
        assertEquals(data.voided_counterpick_bids.length, 1)
        assertEquals(data.voided_counterpick_bids[0].bid_id, bidRow!.id)

        const { data: bidAfter } = await serviceClient
          .from('counterpick_bids')
          .select('status')
          .eq('id', bidRow!.id)
          .single()
        assertEquals(bidAfter?.status, 'cancelled')

        const { data: counterpickAfter } = await serviceClient
          .from('counterpicks')
          .select('id')
          .eq('league_id', leagueId)
          .eq('movie_id', draftPick!.movie_id)
          .maybeSingle()
        assertEquals(counterpickAfter, null)

        const { data: draftPickAfter } = await serviceClient
          .from('draft_picks')
          .select('counterpicked_by_team_id')
          .eq('id', draftPickId)
          .single()
        assertEquals(draftPickAfter?.counterpicked_by_team_id, null)

        const { data: budgetAfter } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', bidderTeam.teamId)
          .single()
        assertEquals(budgetAfter?.remaining_budget, budgetBefore?.remaining_budget)

        const bidderUserId = await getUserId(client)
        const { data: notification } = await serviceClient
          .from('notifications')
          .select('type, data')
          .eq('user_id', bidderUserId)
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        assertExists(notification)
        assertEquals(notification?.type, 'bid_lost')
        assertEquals((notification?.data as Record<string, unknown>)?.reason, 'movie_released')
        assertEquals((notification?.data as Record<string, unknown>)?.bid_type, 'counterpick')
      })

      // Guards the interaction between release voiding and the slot caps from
      // issue #24: a contest on a released movie is dropped BEFORE winners are
      // resolved, so it never consumes one of the bidder's slots. Were the two
      // ordered the other way, the team's priority-1 bid would take its only
      // slot and then be voided, leaving it with nothing.
      await t.step('a voided counterpick contest does not consume the bidder\'s slot', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('void-cp-slot'), 2)
        await serviceClient.from('leagues').update({ bidding_counterpick_slots: 1 }).eq('id', leagueId)

        const targetTeam = await factory.getTeamForUser(leagueId, secondClient)
        const bidderTeam = await factory.getTeamForUser(leagueId, client)
        if (!targetTeam || !bidderTeam) throw new Error('Team not found')

        // Two movies owned by the target team: one that releases before
        // processing, one still upcoming.
        const releasedTmdbId = uniqueVoidTestTmdbId()
        const upcomingTmdbId = uniqueVoidTestTmdbId()

        const releasedPickId = await factory.createDraftPickForUser(leagueId, secondClient, {
          tmdb_id: releasedTmdbId,
          title: `Void Slot Released ${releasedTmdbId}`,
          release_date: '2099-01-01',
        })
        const upcomingPickId = await factory.createDraftPickForUser(leagueId, secondClient, {
          tmdb_id: upcomingTmdbId,
          title: `Void Slot Upcoming ${upcomingTmdbId}`,
          release_date: '2099-01-01',
        })

        const { data: picks } = await serviceClient
          .from('draft_picks')
          .select('id, movie_id')
          .in('id', [releasedPickId, upcomingPickId])
        assertExists(picks)

        const releasedMovieId = picks!.find((p) => p.id === releasedPickId)!.movie_id
        const upcomingMovieId = picks!.find((p) => p.id === upcomingPickId)!.movie_id

        const seedBid = async (movieId: string, draftPickId: string, priority: number) => {
          const { data, error } = await serviceClient
            .from('counterpick_bids')
            .insert({
              league_id: leagueId,
              team_id: bidderTeam.teamId,
              movie_id: movieId,
              target_team_id: targetTeam.teamId,
              draft_pick_id: draftPickId,
              amount: 5,
              priority,
              status: 'active',
              processing_deadline: new Date(Date.now() - 60_000).toISOString(),
            })
            .select('id')
            .single()
          assertEquals(error, null)
          assertExists(data)
          return data!.id
        }

        // Priority 1 is the doomed one: without the fix it wins the single slot.
        const releasedBidId = await seedBid(releasedMovieId, releasedPickId, 1)
        await seedBid(upcomingMovieId, upcomingPickId, 2)

        await serviceClient
          .from('movies')
          .update({ release_date: '2020-01-01' })
          .eq('id', releasedMovieId)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)

        const { data: voidedBid } = await serviceClient
          .from('counterpick_bids')
          .select('status')
          .eq('id', releasedBidId)
          .single()
        assertEquals(voidedBid?.status, 'cancelled')

        // The slot survived the void and went to the upcoming movie.
        assertEquals(data.counterpick_processed, 1)

        const { data: awarded } = await serviceClient
          .from('counterpicks')
          .select('movie_id')
          .eq('league_id', leagueId)
          .eq('counterpicker_team_id', bidderTeam.teamId)
          .eq('phase', 'bidding')
        assertExists(awarded)
        assertEquals(awarded!.length, 1)
        assertEquals(awarded![0].movie_id, upcomingMovieId)
      })

      // ============================================================================
      // Pickup-sourced counterpicks (3c)
      //
      // Before this fix, a counterpick_bids row won on a pickup-acquired movie
      // carried pickup_id but no draft_pick_id. process-bids inserted the
      // counterpicks row with only draft_pick_id (null here) and no pickup_id,
      // violating counterpicks_exactly_one_source and silently failing the
      // award. This confirms the fix: the winning bid's source column now
      // drives both the counterpicks insert and the flag update.
      // ============================================================================

      await t.step('processes a counterpick bid on a pickup-acquired movie end to end (3c)', async () => {
        const leagueId = await factory.createActiveLeague(uniqueName('cp-pickup-league'), 2)
        await serviceClient.from('leagues').update({ bidding_counterpick_slots: 2 }).eq('id', leagueId)

        const targetTeam = await factory.getTeamForUser(leagueId, secondClient)
        const bidderTeam = await factory.getTeamForUser(leagueId, client)
        if (!targetTeam || !bidderTeam) throw new Error('Team not found')

        // See seedDecoyPickupBid: without a pending pickup bid in this league,
        // process-bids short-circuits before it ever looks at counterpick_bids.
        await seedDecoyPickupBid(serviceClient, leagueId, targetTeam.teamId)

        const tmdbId = uniqueVoidTestTmdbId()
        const movieTitle = `Pickup CP Test Movie ${tmdbId}`

        const pickupId = await factory.createPickupForUser(leagueId, secondClient, {
          tmdb_id: tmdbId,
          title: movieTitle,
          release_date: '2099-01-01',
        })

        const { data: pickup } = await serviceClient
          .from('pickups')
          .select('movie_id, team_id')
          .eq('id', pickupId)
          .single()
        assertExists(pickup)
        assertEquals(pickup!.team_id, targetTeam.teamId)

        const { data: budgetBefore } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', bidderTeam.teamId)
          .single()

        const { data: bidRow, error: bidInsertError } = await serviceClient
          .from('counterpick_bids')
          .insert({
            league_id: leagueId,
            team_id: bidderTeam.teamId,
            movie_id: pickup!.movie_id,
            target_team_id: targetTeam.teamId,
            pickup_id: pickupId,
            amount: 9,
            status: 'active',
            processing_deadline: new Date(Date.now() - 60_000).toISOString(),
          })
          .select('id')
          .single()

        assertEquals(bidInsertError, null)
        assertExists(bidRow)

        const { status, data } = await callProcessBids({ mode: 'weekly', league_id: leagueId })
        assertEquals(status, 200)
        assertEquals(data.errors, undefined)
        assertEquals(data.counterpick_processed, 1)
        assertEquals(data.counterpick_results[0].movie_title, movieTitle)
        assertEquals(data.voided_counterpick_bids, undefined)

        const { data: bidAfter } = await serviceClient
          .from('counterpick_bids')
          .select('status')
          .eq('id', bidRow!.id)
          .single()
        assertEquals(bidAfter?.status, 'won')

        const { data: counterpickAfter } = await serviceClient
          .from('counterpicks')
          .select('pickup_id, draft_pick_id, counterpicker_team_id, target_team_id')
          .eq('league_id', leagueId)
          .eq('movie_id', pickup!.movie_id)
          .single()
        assertExists(counterpickAfter)
        assertEquals(counterpickAfter?.pickup_id, pickupId)
        assertEquals(counterpickAfter?.draft_pick_id, null)
        assertEquals(counterpickAfter?.counterpicker_team_id, bidderTeam.teamId)
        assertEquals(counterpickAfter?.target_team_id, targetTeam.teamId)

        const { data: pickupAfter } = await serviceClient
          .from('pickups')
          .select('counterpicked_by_team_id')
          .eq('id', pickupId)
          .single()
        assertEquals(pickupAfter?.counterpicked_by_team_id, bidderTeam.teamId)

        const { data: budgetAfter } = await serviceClient
          .from('team_budgets')
          .select('remaining_budget')
          .eq('team_id', bidderTeam.teamId)
          .single()
        assertEquals(budgetAfter?.remaining_budget, (budgetBefore?.remaining_budget ?? 0) - 9)
      })

    } finally {
      await factory.cleanup()
    }
  },
})
