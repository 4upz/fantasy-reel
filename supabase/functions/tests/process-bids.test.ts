/**
 * Integration tests for process-bids Edge Function
 *
 * Requires: npx supabase start && npx supabase functions serve
 */

import { assertEquals, assertExists } from '@std/assert'
import { getServiceClient, createTestFactory, uniqueName } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/process-bids`

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
    const SERVICE_ROLE_KEY = await getEdgeFunctionServiceRoleKey()

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
        const mockWebhookUrl = `http://host.docker.internal:${localPort}/webhook`

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
        const mockWebhookUrl = `http://host.docker.internal:${localPort}/webhook`

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
