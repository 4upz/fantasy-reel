/**
 * Core logic for send-announcement, kept in a module separate from index.ts
 * so unit tests can import it without triggering index.ts's top-level
 * Deno.serve() (which would open a real listener as a side effect of the
 * import).
 *
 * League-owner-only. Posts a commissioner announcement embed to every
 * enabled Discord channel linked to the league, bypassing per-channel
 * category toggles (category: 'general') -- an owner posting on purpose
 * should reach every linked channel, the same reasoning as the new-member
 * notification in join-league.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidUUID } from '../_shared/utils.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor } from '../_shared/discord.ts'

export const MAX_MESSAGE_LENGTH = 1500

export interface SendAnnouncementRequest {
  league_id?: string
  message?: string
}

export interface SendAnnouncementResult {
  message: string
  channels_notified: number
}

/**
 * `userClient` is the caller's RLS-scoped client, used only for the
 * ownership check; `serviceClient` is used for Discord delivery, matching
 * every other notification-sending function (discord_channels.webhook_url
 * is a credential column).
 */
export async function runSendAnnouncement(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  body: SendAnnouncementRequest
): Promise<{ status: number; result: SendAnnouncementResult | { error: string } }> {
  const { league_id, message } = body

  if (!league_id || !isValidUUID(league_id)) {
    return { status: 400, result: { error: 'Valid league_id is required' } }
  }

  const trimmedMessage = (message ?? '').trim()
  if (!trimmedMessage) {
    return { status: 400, result: { error: 'Announcement message cannot be empty' } }
  }
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    return { status: 400, result: { error: `Announcement cannot exceed ${MAX_MESSAGE_LENGTH} characters` } }
  }

  const { data: league, error: leagueError } = await userClient
    .from('leagues')
    .select('id, name, owner_id')
    .eq('id', league_id)
    .single()

  if (leagueError || !league) {
    return { status: 404, result: { error: 'League not found' } }
  }

  if (league.owner_id !== userId) {
    return { status: 403, result: { error: 'Only the league owner can post announcements' } }
  }

  const { count: channelsNotified } = await serviceClient
    .from('discord_channels')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', league_id)
    .eq('enabled', true)

  await sendDiscordNotification(serviceClient, {
    leagueId: league_id,
    category: 'general',
    embeds: [{
      author: buildEmbedAuthor(league.name, league_id),
      title: '📣 Announcement from the commissioner',
      description: trimmedMessage,
      color: DISCORD_COLORS.gold,
      footer: { text: league.name },
      url: buildLeagueUrl(league_id),
    }],
  })

  return {
    status: 200,
    result: { message: 'Announcement posted', channels_notified: channelsNotified ?? 0 },
  }
}
