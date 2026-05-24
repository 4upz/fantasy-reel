/**
 * Discord webhook utilities for sending league notifications.
 * Follows email.ts pattern: never throws, catches internally.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// Types
// ============================================================================

export type NotificationCategory = 'drafts' | 'bids' | 'trades' | 'scores'

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  thumbnail?: { url: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  url?: string
  author?: { name: string; icon_url?: string; url?: string }
}

interface DiscordChannel {
  id: string
  webhook_url: string
  thread_id: string | null
  bid_alert_role_id: string | null
  notify_drafts: boolean
  notify_bids: boolean
  notify_trades: boolean
  notify_scores: boolean
  consecutive_failures: number
}

// ============================================================================
// Constants
// ============================================================================

/** Color constants matching design system tokens in globals.css */
export const DISCORD_COLORS = {
  /** "Something happened" -- draft picks, proposals, general events */
  gold: 0xc9a227,
  /** "Resolved positively" -- bid won, trade completed, draft complete */
  green: 0x22c55e,
  /** "Denied/negative" -- bid lost, trade rejected, trade vetoed */
  crimson: 0xa8505c,
  /** "FYI, no action needed" -- score updates, slash command responses */
  blue: 0x3b82f6,
  /** "You may need to act" -- outbid, trade countered, your turn to pick */
  yellow: 0xf59e0b,
} as const

export const FANTASY_REEL_ICON = 'https://fantasy-reel.vercel.app/icon-128.png'

// ============================================================================
// Category → Column Mapping
// ============================================================================

const CATEGORY_COLUMN: Record<NotificationCategory, keyof DiscordChannel> = {
  drafts: 'notify_drafts',
  bids: 'notify_bids',
  trades: 'notify_trades',
  scores: 'notify_scores',
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Send a Discord notification to all enabled channels for a league.
 *
 * Uses the service role client (bypasses RLS) to read webhook URLs.
 * Never throws -- catches all errors internally and logs with console.error.
 *
 * IMPORTANT: Must be awaited, not fire-and-forget. Supabase Edge Functions
 * may terminate after sending the response, aborting in-flight fetch() calls.
 */
export async function sendDiscordNotification(
  supabase: SupabaseClient,
  params: {
    leagueId: string
    category: NotificationCategory
    content?: string
    embeds?: DiscordEmbed[]
    mentionRole?: boolean
  }
): Promise<void> {
  try {
    const { leagueId, category, content, embeds, mentionRole } = params

    // Fetch enabled channels for this league
    const { data: channels, error: fetchError } = await supabase
      .from('discord_channels')
      .select('id, webhook_url, thread_id, bid_alert_role_id, notify_drafts, notify_bids, notify_trades, notify_scores, consecutive_failures')
      .eq('league_id', leagueId)
      .eq('enabled', true)

    if (fetchError) {
      console.error('Failed to fetch discord channels:', fetchError.message)
      return
    }

    if (!channels || channels.length === 0) {
      console.log(`[discord] sendDiscordNotification: No enabled channels found for league ${leagueId}`)
      return
    }

    // Filter by category preference
    const column = CATEGORY_COLUMN[category]
    const eligibleChannels = channels.filter(
      (ch: DiscordChannel) => ch[column] === true
    )

    if (eligibleChannels.length === 0) {
      console.log(`[discord] sendDiscordNotification: No channels with category "${category}" enabled for league ${leagueId}`)
      return
    }

    // Send to each channel
    const results = await Promise.allSettled(
      eligibleChannels.map((channel: DiscordChannel) =>
        sendToWebhook(supabase, channel, { content, embeds, mentionRole })
      )
    )

    // Log any failures (don't throw)
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.error(
          `Discord webhook failed for channel ${eligibleChannels[i].id}:`,
          (results[i] as PromiseRejectedResult).reason
        )
      }
    }
  } catch (error) {
    console.error('Unexpected error in sendDiscordNotification:', error)
  }
}

// ============================================================================
// Webhook Delivery
// ============================================================================

async function sendToWebhook(
  supabase: SupabaseClient,
  channel: DiscordChannel,
  payload: {
    content?: string
    embeds?: DiscordEmbed[]
    mentionRole?: boolean
  }
): Promise<void> {
  const { content, embeds, mentionRole } = payload

  // Build content with optional role mention
  let finalContent = content ?? ''
  if (mentionRole && channel.bid_alert_role_id) {
    const mention = `<@&${channel.bid_alert_role_id}>`
    finalContent = finalContent ? `${mention} ${finalContent}` : mention
  }

  const body: Record<string, unknown> = {
    username: 'Fantasy Reel',
    avatar_url: FANTASY_REEL_ICON,
  }

  if (finalContent) body.content = finalContent
  if (embeds && embeds.length > 0) body.embeds = embeds

  try {
    const webhookUrl = new URL(channel.webhook_url)
    if (channel.thread_id) webhookUrl.searchParams.set('thread_id', channel.thread_id)

    const response = await fetch(webhookUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      // Reset failure tracking on success
      if (channel.consecutive_failures > 0) {
        await supabase
          .from('discord_channels')
          .update({ consecutive_failures: 0, last_error_at: null })
          .eq('id', channel.id)
      }
    } else {
      console.error(
        `Discord webhook returned ${response.status} for channel ${channel.id}`
      )
      await trackFailure(supabase, channel.id)
    }
  } catch (error) {
    console.error(`Discord webhook network error for channel ${channel.id}:`, error)
    await trackFailure(supabase, channel.id)
  }
}

async function trackFailure(supabase: SupabaseClient, channelId: string): Promise<void> {
  try {
    // Use RPC-style increment to avoid race conditions
    const { data: current } = await supabase
      .from('discord_channels')
      .select('consecutive_failures')
      .eq('id', channelId)
      .single()

    const newCount = (current?.consecutive_failures ?? 0) + 1

    await supabase
      .from('discord_channels')
      .update({
        consecutive_failures: newCount,
        last_error_at: new Date().toISOString(),
      })
      .eq('id', channelId)
  } catch (error) {
    // Don't let failure tracking break the main flow
    console.error('Failed to track webhook failure:', error)
  }
}

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Build a URL to a league page. Uses SITE_URL in Supabase Edge Functions runtime.
 */
export function buildLeagueUrl(leagueId: string, path = ''): string {
  const baseUrl = Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
  return `${baseUrl}/league/${leagueId}${path}`
}

export async function getLeagueName(
  supabase: SupabaseClient,
  leagueId: string
): Promise<string> {
  const { data } = await supabase
    .from('leagues')
    .select('name')
    .eq('id', leagueId)
    .single()

  return data?.name ?? 'League'
}

export function buildEmbedAuthor(leagueName: string, leagueId: string): DiscordEmbed['author'] {
  return { name: leagueName, icon_url: FANTASY_REEL_ICON, url: buildLeagueUrl(leagueId) }
}
