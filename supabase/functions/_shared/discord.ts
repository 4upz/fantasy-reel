/**
 * Discord webhook utilities for sending league notifications.
 * Follows email.ts pattern: never throws, catches internally.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchWithTimeout } from './http.ts'
import { createLogger, serializeError } from './logger.ts'
import { alertOps } from './ops-alerts.ts'

const log = createLogger('shared/discord')

// ============================================================================
// Types
// ============================================================================

export type NotificationCategory =
  | 'drafts'
  | 'bids'
  | 'trades'
  | 'scores'
  /** Release-day announcements and release-date change alerts. */
  | 'movie_news'
  /** Monday "releasing this week" digest. */
  | 'weekly_digest'
  /** No per-channel toggle -- always eligible (any enabled channel). Used for
   * rare, benign, or owner-initiated sends where gating would just be friction:
   * new-member notices and commissioner announcements. */
  | 'general'

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
  notify_weekly_digest: boolean
  notify_movie_news: boolean
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

/** 'general' has no entry -- it bypasses per-channel category filtering entirely. */
const CATEGORY_COLUMN: Partial<Record<NotificationCategory, keyof DiscordChannel>> = {
  drafts: 'notify_drafts',
  bids: 'notify_bids',
  trades: 'notify_trades',
  scores: 'notify_scores',
  movie_news: 'notify_movie_news',
  weekly_digest: 'notify_weekly_digest',
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Send a Discord notification to all enabled channels for a league.
 *
 * Uses the service role client (bypasses RLS) to read webhook URLs.
 * Never throws -- catches all errors internally and logs them via the shared logger.
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
      .select('id, webhook_url, thread_id, bid_alert_role_id, notify_drafts, notify_bids, notify_trades, notify_scores, notify_weekly_digest, notify_movie_news, consecutive_failures')
      .eq('league_id', leagueId)
      .eq('enabled', true)

    if (fetchError) {
      log.error('Failed to fetch discord channels', { league_id: leagueId, error: fetchError.message })
      return
    }

    if (!channels || channels.length === 0) {
      log.info('No enabled channels found for league', { league_id: leagueId })
      return
    }

    // Filter by category preference. 'general' has no CATEGORY_COLUMN entry,
    // so every enabled channel is eligible regardless of toggle state.
    const column = CATEGORY_COLUMN[category]
    const eligibleChannels = column
      ? channels.filter((ch: DiscordChannel) => ch[column] === true)
      : channels

    if (eligibleChannels.length === 0) {
      log.info('No channels with category enabled for league', { category, league_id: leagueId })
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
        log.error('Discord webhook failed', {
          channel_id: eligibleChannels[i].id,
          error: serializeError((results[i] as PromiseRejectedResult).reason),
        })
      }
    }
  } catch (error) {
    log.error('Unexpected error in sendDiscordNotification', { error: serializeError(error) })
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

    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }

    let response = await fetchWithTimeout(webhookUrl.toString(), requestInit, 10_000)

    // Discord rate limits are expected under load, not exceptional -- honour
    // retry_after and retry once before treating it as a plain failure.
    if (response.status === 429) {
      const retryAfterMs = await parseDiscordRetryAfterMs(response)
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterMs, 5000)))
      response = await fetchWithTimeout(webhookUrl.toString(), requestInit, 10_000)
    }

    if (response.ok) {
      // Reset failure tracking on success
      if (channel.consecutive_failures > 0) {
        await supabase
          .from('discord_channels')
          .update({ consecutive_failures: 0, last_error_at: null })
          .eq('id', channel.id)
      }
    } else {
      log.error('Discord webhook returned non-OK status', { channel_id: channel.id, status: response.status })
      await trackFailure(supabase, channel.id)
    }
  } catch (error) {
    log.error('Discord webhook network error', { channel_id: channel.id, error: serializeError(error) })
    await trackFailure(supabase, channel.id)
  }
}

/** Reads Discord's rate-limit wait time off a 429: the JSON body's `retry_after` (seconds), falling back to the `Retry-After` header. */
async function parseDiscordRetryAfterMs(response: Response): Promise<number> {
  try {
    const body = await response.json()
    if (typeof body?.retry_after === 'number') return body.retry_after * 1000
  } catch {
    // Not JSON -- fall back to the header below
  }
  const header = response.headers.get('Retry-After')
  const seconds = header ? Number(header) : NaN
  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

async function trackFailure(supabase: SupabaseClient, channelId: string): Promise<void> {
  try {
    // Read-then-write increment -- not atomic, so concurrent failures for the
    // same channel could race and under-count consecutive_failures. Low
    // stakes: this only affects failure-tracking counters, not core writes.
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

    // Alert once on the threshold crossing, not on every subsequent failure.
    if (newCount === 3) {
      await alertOps('Discord webhook failing for channel', {
        channel_id: channelId,
        consecutive_failures: newCount,
      })
    }
  } catch (error) {
    // Don't let failure tracking break the main flow
    log.error('Failed to track webhook failure', { channel_id: channelId, error: serializeError(error) })
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

export interface NewBidEmbedParams {
  leagueId: string
  leagueName: string
  movieTitle: string
  posterPath?: string | null
  releaseDate?: string | null
  /** The amount of the bid being announced. */
  amount: number
  /** The bid group's regular weekly deadline. */
  processingDeadline: Date
  /** Appended to the embed title, e.g. ' (🎯 Counterpick)'. */
  titleSuffix?: string
}

export interface CounterBidEmbedParams extends Omit<NewBidEmbedParams, 'amount'> {
  previousAmount: number
  newAmount: number
  /** When the just-outbid team's counter-response window ends. */
  counterWindowEnds: Date
}

/**
 * The bids-channel embed for the opening bid on a movie.
 *
 * States what happened and for how much -- the amount is already public on the
 * bidding page, so hiding it here only made the channel less useful. Bidder and
 * team names stay out of it.
 */
export function buildNewBidEmbed(params: NewBidEmbedParams): DiscordEmbed {
  const closesAt = params.processingDeadline.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  return {
    author: buildEmbedAuthor(params.leagueName, params.leagueId),
    title: `New Bid: ${params.movieTitle}${params.titleSuffix ?? ''}`,
    thumbnail: params.posterPath ? { url: `https://image.tmdb.org/t/p/w92${params.posterPath}` } : undefined,
    color: DISCORD_COLORS.gold,
    fields: [
      { name: 'Bid', value: `$${params.amount}`, inline: true },
      ...(params.releaseDate ? [{ name: 'Release Date', value: params.releaseDate, inline: true }] : []),
    ],
    footer: { text: `Bidding closes ${closesAt}` },
    url: buildLeagueUrl(params.leagueId, '/bidding'),
  }
}

/**
 * The bids-channel embed for a bid that took the lead from another team.
 *
 * Unlike buildNewBidEmbed, this one shows both amounts (already public on the
 * bidding page) and when results are now expected: the later of the weekly
 * processing deadline and the outbid team's counter window, since an open
 * window holds the whole movie past the weekly run. Rendered as a Discord
 * `<t:…>` timestamp so each viewer sees their own timezone -- which is also why
 * it lives in a field, not the footer (footers don't render timestamp markup).
 * Team names stay out of it.
 */
export function buildCounterBidEmbed(params: CounterBidEmbedParams): DiscordEmbed {
  const effectiveCloseMs = Math.max(
    params.processingDeadline.getTime(),
    params.counterWindowEnds.getTime(),
  )
  const unixSeconds = Math.floor(effectiveCloseMs / 1000)

  return {
    author: buildEmbedAuthor(params.leagueName, params.leagueId),
    title: `Counter Bid: ${params.movieTitle}${params.titleSuffix ?? ''}`,
    description: 'The leading bid was raised. The outbid team can counter back.',
    thumbnail: params.posterPath ? { url: `https://image.tmdb.org/t/p/w92${params.posterPath}` } : undefined,
    color: DISCORD_COLORS.gold,
    fields: [
      { name: 'Previous Bid', value: `$${params.previousAmount}`, inline: true },
      { name: 'New Bid', value: `$${params.newAmount}`, inline: true },
      ...(params.releaseDate ? [{ name: 'Release Date', value: params.releaseDate, inline: true }] : []),
      { name: 'Results Expected', value: `<t:${unixSeconds}:f> (<t:${unixSeconds}:R>)`, inline: false },
    ],
    footer: { text: 'Estimated — another counter bid extends the window' },
    url: buildLeagueUrl(params.leagueId, '/bidding'),
  }
}
