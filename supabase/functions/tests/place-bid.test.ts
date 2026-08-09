/**
 * Integration tests for place-bid Edge Function
 *
 * Tests the actual function via client.functions.invoke()
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestFactory, getAnonClient, getServiceClient, uniqueName, invokeFunction } from './_setup.ts'

// Test movie data for bidding
const currentYear = new Date().getFullYear()
const testMovieData = {
  title: 'Test Pickup Movie',
  overview: 'A test movie for bidding',
  poster_url: '/test-poster.jpg',
  release_date: `${currentYear}-12-15`,
  vote_average: 0,
  popularity: 100,
  genre_ids: [28, 12],
}

/**
 * Generate a tmdb_id well outside the real TMDb ID range and the shared
 * draft-movie pool (factory picks start at 900_100_001 - see
 * createActiveLeague) and outside other test files' void ranges (e.g.
 * process-bids.test.ts uses 950_000_000+). Release-date tests need a movie
 * nobody else touches so they don't corrupt the shared pool.
 */
function uniqueVoidTestTmdbId(): number {
  return 960_000_000 + Math.floor(Math.random() * 1_000_000)
}

/**
 * The `supabase start` edge runtime serves the *main checkout's* functions, so
 * a worktree change is only exercised by pointing PLACE_BID_URL at a standalone
 * `deno run place-bid/index.ts` (which binds :8000) -- the same pattern as
 * PROCESS_BIDS_URL in process-bids.test.ts. Unset, calls go through the SDK to
 * the shared runtime as before.
 */
const PLACE_BID_URL = Deno.env.get('PLACE_BID_URL')

/**
 * Host the function should call back on to reach a server this test started.
 * `host.docker.internal` is how the containerised edge runtime reaches the host,
 * and it does not resolve from the host itself -- so a standalone run needs
 * loopback instead.
 */
const CALLBACK_HOST = PLACE_BID_URL ? '127.0.0.1' : 'host.docker.internal'

interface PlaceBidResponse {
  bid?: { id: string; amount: number }
  message?: string
  error?: string
}

/** Just the parts of the Discord webhook payload these tests assert on. */
interface WebhookPayload {
  embeds: Array<{
    title?: string
    fields?: Array<{ name: string; value: string }>
  }>
}

function fieldsByName(payload: WebhookPayload): Map<string, string> {
  return new Map((payload.embeds[0].fields ?? []).map((field) => [field.name, field.value]))
}

async function callPlaceBid(
  userClient: SupabaseClient,
  body: Record<string, unknown>,
): Promise<PlaceBidResponse> {
  if (!PLACE_BID_URL) {
    const { data, error } = await userClient.functions.invoke<PlaceBidResponse>('place-bid', { body })
    if (error) return { error: String(error) }
    return data ?? {}
  }

  const { data: { session } } = await userClient.auth.getSession()
  const response = await fetch(PLACE_BID_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session!.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return await response.json() as PlaceBidResponse
}

Deno.test({
  name: 'place-bid',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // ============================================================================
    // Authentication Tests
    // ============================================================================

    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'Unauthorized')
    })

    // ============================================================================
    // Validation Tests
    // ============================================================================

    await t.step('returns 400 for missing league_id', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for invalid league_id', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: 'not-a-uuid',
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'Valid league_id is required')
    })

    await t.step('returns 400 for missing tmdb_id', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        amount: 10,
      })
      assertEquals(result.error, 'Valid tmdb_id is required')
    })

    await t.step('returns 400 for invalid tmdb_id', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: -5,
        amount: 10,
      })
      assertEquals(result.error, 'Valid tmdb_id is required')
    })

    await t.step('returns 400 for negative amount', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: -1,
      })
      assertEquals(result.error, 'Amount must be a whole number between 0 and 100')
    })

    await t.step('returns 400 for amount over 100', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: 150,
      })
      assertEquals(result.error, 'Amount must be a whole number between 0 and 100')
    })

    await t.step('returns 400 for non-integer amount', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: 10.5,
      })
      assertEquals(result.error, 'Amount must be a whole number between 0 and 100')
    })

    // ============================================================================
    // Not Found Tests
    // ============================================================================

    await t.step('returns 404 when league does not exist', async () => {
      const result = await invokeFunction(client, 'place-bid', {
        league_id: '00000000-0000-0000-0000-000000000000',
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'League not found')
    })

    // ============================================================================
    // Status Tests
    // ============================================================================

    await t.step('returns 400 when league is not active (setup status)', async () => {
      const { id: leagueId } = await factory.createLeague(uniqueName('bid-setup'))

      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'League is not active')
    })

    await t.step('returns 400 when league is in drafting status', async () => {
      const leagueId = await factory.createDraftingLeague(uniqueName('bid-drafting'))

      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 12345,
        amount: 10,
      })
      assertEquals(result.error, 'League is not active')
    })

    // ============================================================================
    // Authorization Tests
    // ============================================================================

    await t.step('returns 403 when user is not a member of the league', async () => {
      // Create active league and complete draft with first user
      const leagueId = await factory.createActiveLeague(uniqueName('bid-not-member'))

      // Create a third user who isn't in this league
      const thirdClient = await factory.createThirdClient()

      const result = await invokeFunction(thirdClient, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 300001,
        amount: 10,
        movie_data: { ...testMovieData, title: 'Non-member Bid Movie' },
      })
      assertEquals(result.error, 'You are not a member of this league')
    })

    // ============================================================================
    // Budget Tests
    // ============================================================================

    await t.step('returns 400 when bid exceeds remaining budget', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-over-budget'))

      // Team budget starts at 100
      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 300002,
        amount: 101, // Over budget
        movie_data: { ...testMovieData, title: 'Over Budget Movie' },
      })
      // Amount validation happens first
      assertEquals(result.error, 'Amount must be a whole number between 0 and 100')
    })

    // ============================================================================
    // Success Tests
    // ============================================================================

    await t.step('successfully places bid on eligible movie', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-success'))

      const { data, error } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300003,
          amount: 15,
          movie_data: { ...testMovieData, title: 'Successful Bid Movie' },
        },
      })

      assertEquals(error, null)
      assertExists(data.bid)
      assertEquals(data.bid.league_id, leagueId)
      assertEquals(data.bid.tmdb_id, 300003)
      assertEquals(data.bid.amount, 15)
      assertEquals(data.bid.status, 'active')
      assertEquals(data.message, 'Bid placed successfully')
      assertEquals(data.was_update, false)
    })

    await t.step('successfully places $0 bid', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-zero'))

      const { data, error } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300004,
          amount: 0,
          movie_data: { ...testMovieData, title: 'Zero Bid Movie' },
        },
      })

      assertEquals(error, null)
      assertExists(data.bid)
      assertEquals(data.bid.amount, 0)
      assertEquals(data.bid.status, 'active')
    })

    // ============================================================================
    // Outbidding Tests
    // ============================================================================

    await t.step('successfully outbids another team', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-outbid'))

      // First user places bid
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300005,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Outbid Movie' },
        },
      })

      // Second user outbids
      const { data, error } = await secondClient.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300005,
          amount: 15,
          movie_data: { ...testMovieData, title: 'Outbid Movie' },
        },
      })

      assertEquals(error, null)
      assertExists(data.bid)
      assertEquals(data.bid.amount, 15)
      assertEquals(data.bid.status, 'active')
      assertEquals(data.message, 'You are now the highest bidder')
    })

    await t.step('returns 400 when bid is not higher than current highest', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-not-higher'))

      // First user places bid of $20
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300006,
          amount: 20,
          movie_data: { ...testMovieData, title: 'High Bid Movie' },
        },
      })

      // Second user tries to bid $15 (not higher)
      const result = await invokeFunction(secondClient, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 300006,
        amount: 15,
        movie_data: { ...testMovieData, title: 'High Bid Movie' },
      })

      assertEquals(result.error, 'There is already a bid of $20. You must bid higher.')
    })

    await t.step('returns 400 when bid equals current highest', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-equal'))

      // First user places bid of $25
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300007,
          amount: 25,
          movie_data: { ...testMovieData, title: 'Equal Bid Movie' },
        },
      })

      // Second user tries to bid $25 (equal, not higher). The real client
      // always resupplies movie_data, including on a counter-bid.
      const result = await invokeFunction(secondClient, 'place-bid', {
        league_id: leagueId,
        tmdb_id: 300007,
        amount: 25,
        movie_data: { ...testMovieData, title: 'Equal Bid Movie' },
      })

      assertEquals(result.error, 'There is already a bid of $25. You must bid higher.')
    })

    // ============================================================================
    // Update Existing Bid Tests
    // ============================================================================

    await t.step('updates existing bid from same team', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-update'))

      // First bid
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300008,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Update Bid Movie' },
        },
      })

      // Update bid. The real client always resupplies movie_data.
      const { data, error } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300008,
          amount: 20,
          movie_data: { ...testMovieData, title: 'Update Bid Movie' },
        },
      })

      assertEquals(error, null)
      assertExists(data.bid)
      assertEquals(data.bid.amount, 20)
      assertEquals(data.was_update, true)
    })

    await t.step('can raise own bid after being outbid', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-counter'))

      // First user bids $10
      await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300009,
          amount: 10,
          movie_data: { ...testMovieData, title: 'Counter Bid Movie' },
        },
      })

      // Second user outbids with $15. The real client always resupplies
      // movie_data, including on a counter-bid.
      await secondClient.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300009,
          amount: 15,
          movie_data: { ...testMovieData, title: 'Counter Bid Movie' },
        },
      })

      // First user counters with $20
      const { data, error } = await client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 300009,
          amount: 20,
          movie_data: { ...testMovieData, title: 'Counter Bid Movie' },
        },
      })

      assertEquals(error, null)
      assertExists(data.bid)
      assertEquals(data.bid.amount, 20)
      assertEquals(data.bid.status, 'active')
      assertEquals(data.was_update, true)
    })

    // ============================================================================
    // Movie Eligibility Tests
    // ============================================================================

    await t.step('returns 400 when movie is already drafted in league', async () => {
      // This test requires a movie that was drafted during the draft phase
      const leagueId = await factory.createActiveLeague(uniqueName('bid-drafted'))

      // Look up a tmdb_id that was actually drafted during league creation
      // rather than hardcoding the factory's counter base.
      const { data: draftedPick } = await getServiceClient()
        .from('draft_picks')
        .select('movies(tmdb_id)')
        .eq('league_id', leagueId)
        .limit(1)
        .single()
      const draftedTmdbId = (draftedPick as unknown as { movies: { tmdb_id: number } }).movies.tmdb_id

      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: draftedTmdbId,
        amount: 10,
      })

      assertEquals(result.error, 'Movie is not eligible for pickup (already owned or scored)')
    })

    // ============================================================================
    // Release-Date Validation Tests
    //
    // A movie whose release_date has already passed has a known outcome -
    // bidding on it is a risk-free exploit. place-bid must reject it before
    // ever creating a pickup_bids row.
    // ============================================================================

    await t.step('returns 400 when movie has already been released', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-released'))
      const tmdbId = uniqueVoidTestTmdbId()

      const result = await invokeFunction(client, 'place-bid', {
        league_id: leagueId,
        tmdb_id: tmdbId,
        amount: 10,
        movie_data: { ...testMovieData, title: 'Released Movie', release_date: '2020-01-01' },
      })

      assertEquals(result.status, 400)
      assertEquals(result.error, 'Cannot bid on this movie: Movie was released in a previous year')

      // No bid should have been created for the rejected movie
      const { data: bids } = await getServiceClient()
        .from('pickup_bids')
        .select('id')
        .eq('league_id', leagueId)
        .eq('tmdb_id', tmdbId)
      assertEquals(bids?.length ?? 0, 0)
    })

    await t.step('Discord embed distinguishes a counter bid, with amounts and results window', async () => {
      const leagueId = await factory.createActiveLeague(uniqueName('bid-discord'))

      const receivedPayloads: WebhookPayload[] = []
      const server = Deno.serve({ port: 0, hostname: '0.0.0.0' }, async (req) => {
        try {
          receivedPayloads.push(await req.json() as WebhookPayload)
        } catch {
          // Ignore
        }
        return new Response(null, { status: 204 })
      })

      const mockWebhookUrl = `http://${CALLBACK_HOST}:${server.addr.port}/webhook`

      try {
        const { error: channelError } = await getServiceClient()
          .from('discord_channels')
          .insert({
            league_id: leagueId,
            guild_id: 'test-guild-bid-discord',
            channel_id: uniqueName('ch-bid-discord'),
            webhook_id: 'webhook-bid-discord',
            webhook_url: mockWebhookUrl,
            notify_bids: true,
            enabled: true,
          })
        assertEquals(channelError, null)

        const tmdbId = uniqueVoidTestTmdbId()
        const movieData = { ...testMovieData, title: 'Discord Embed Movie' }

        // Opening bid: the embed stays the anonymous movie-only card.
        const first = await callPlaceBid(client, {
          league_id: leagueId,
          tmdb_id: tmdbId,
          amount: 5,
          movie_data: movieData,
        })
        assertExists(first.bid, `first bid failed: ${JSON.stringify(first)}`)

        // Counter bid from the other team: the embed must say what changed.
        const second = await callPlaceBid(secondClient, {
          league_id: leagueId,
          tmdb_id: tmdbId,
          amount: 9,
          movie_data: movieData,
        })
        assertExists(second.bid, `counter bid failed: ${JSON.stringify(second)}`)

        await new Promise((resolve) => setTimeout(resolve, 500))

        assertEquals(receivedPayloads.length, 2)

        assertEquals(receivedPayloads[0].embeds[0].title, 'Discord Embed Movie')
        assertEquals(fieldsByName(receivedPayloads[0]).has('Previous Bid'), false)

        assertEquals(receivedPayloads[1].embeds[0].title, 'Counter Bid: Discord Embed Movie')

        const counterFields = fieldsByName(receivedPayloads[1])
        assertEquals(counterFields.get('Previous Bid'), '$5')
        assertEquals(counterFields.get('New Bid'), '$9')

        // Discord-native timestamp so every viewer sees their own timezone,
        // and "estimated" because further counters can extend it again.
        const resultsExpected = counterFields.get('Results Expected')
        assertExists(resultsExpected)
        assertEquals(/<t:\d+:f> \(<t:\d+:R>\)/.test(resultsExpected), true,
          `unexpected Results Expected value: ${resultsExpected}`)
      } finally {
        await server.shutdown()
      }
    })

    // ============================================================================
    // Cleanup
    // ============================================================================

    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  },
})
