/**
 * Integration tests for process-bids Edge Function
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

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
    const { client, factory } = await createTestFactory()
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

    } finally {
      await factory.cleanup()
    }
  },
})
