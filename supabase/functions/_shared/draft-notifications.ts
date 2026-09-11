import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildEmbedAuthor, buildLeagueUrl, DISCORD_COLORS, sendToWebhook, type DiscordChannel, type DiscordEmbed } from './discord.ts'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/draft-notifications')

export interface DraftNotification {
  id: string
  league_id: string
  channel_id: string
  kind: 'draft_started' | 'draft_pick' | 'league_activated'
  payload: { pick_id?: string; participant_count?: number; next_team_id?: string | null; draft_complete?: boolean }
  lease_token: string
}
export type DeliveryOutcome = 'sent' | 'skipped' | 'retry'

export async function deliverDraftNotification(
  client: SupabaseClient, item: DraftNotification, send: typeof sendToWebhook = sendToWebhook,
): Promise<DeliveryOutcome> {
  const [channelResult, leagueResult] = await Promise.all([
    client.from('discord_channels').select('*').eq('id', item.channel_id).eq('league_id', item.league_id).maybeSingle(),
    client.from('leagues').select('name, status, draft_slots, draft_counterpick_slots').eq('id', item.league_id).maybeSingle(),
  ])
  if (channelResult.error || leagueResult.error) throw channelResult.error ?? leagueResult.error
  const channel = channelResult.data as DiscordChannel | null
  const league = leagueResult.data
  if (!channel || !league || !channelResult.data.enabled || !channel.notify_drafts) return 'skipped'
  const embed: DiscordEmbed = {
    author: buildEmbedAuthor(league.name, item.league_id), color: DISCORD_COLORS.gold,
    url: buildLeagueUrl(item.league_id, '/draft'),
  }
  const embeds = [embed]
  let content: string | undefined
  if (item.kind === 'draft_started') {
    embed.title = 'The Draft Is Open'
    embed.description = `${item.payload.participant_count ?? 'All'} teams are ready. Open the live draft to see whose turn it is.`
  } else if (item.kind === 'league_activated') {
    embed.title = 'Draft Complete'
    embed.description = 'The league is active. View the results and your Fantasy Budget.'
    embed.color = DISCORD_COLORS.green
  } else {
    const { data: pick, error } = await client.from('draft_picks')
      .select('round, pick_number, movies(title, poster_url), teams!draft_picks_team_id_fkey(name)')
      .eq('id', item.payload.pick_id).eq('league_id', item.league_id).maybeSingle()
    if (error) throw error
    if (!pick) return 'skipped'
    const movie = pick.movies as unknown as { title: string; poster_url: string | null }
    const team = pick.teams as unknown as { name: string }
    embed.title = `${team.name} selects ${movie.title}`
    embed.description = `Round ${pick.round}, Pick ${pick.pick_number}. Open the live draft for the current turn.`
    embed.footer = { text: `Round ${pick.round} of ${league.draft_slots}` }
    if (movie.poster_url) embed.thumbnail = { url: movie.poster_url }
    if (item.payload.draft_complete && league.status === 'drafting' && league.draft_counterpick_slots > 0) {
      embeds.push({
        author: buildEmbedAuthor(league.name, item.league_id), title: 'Draft Picks Complete',
        description: 'All draft selections are recorded. The owner can start the counterpick round or activate the league.',
        color: DISCORD_COLORS.yellow, url: buildLeagueUrl(item.league_id, '/draft'),
      })
    }
  }
  // A queued notification may arrive after several later picks. Announce the
  // next player only when the recorded team is still on the clock now.
  if (item.payload.next_team_id && league.status === 'drafting') {
    const { data: turns, error: turnError } = await client.rpc('get_next_draft_pick', { p_league_id: item.league_id })
    if (turnError) throw turnError
    const turn = turns?.[0]
    if (turn?.team_id === item.payload.next_team_id) {
      const [teamResult, linksResult] = await Promise.all([
        client.from('teams').select('name').eq('id', turn.team_id).maybeSingle(),
        client.rpc('get_discord_ids_by_user_ids', { p_user_ids: [turn.user_id] }),
      ])
      if (teamResult.error || linksResult.error) throw teamResult.error ?? linksResult.error
      if (teamResult.data) embed.fields = [{ name: 'Up Next', value: teamResult.data.name, inline: true }]
      const discordId = linksResult.data?.find((link: { user_id: string }) => link.user_id === turn.user_id)?.discord_id
      if (typeof discordId === 'string' && /^\d{1,20}$/.test(discordId)) {
        content = `<@${discordId}>, you're on the clock.`
        embed.color = DISCORD_COLORS.yellow
      }
    }
  }
  return await send(client, channel, { embeds, content }) ? 'sent' : 'retry'
}

async function processBatch(client: SupabaseClient, deliver: typeof deliverDraftNotification) {
  const { data, error } = await client.rpc('claim_draft_notifications', { p_limit: 10 })
  if (error) throw error
  const items = (data ?? []) as DraftNotification[]
  const results = await Promise.all(items.map(async item => {
    let outcome: DeliveryOutcome = 'retry'
    try { outcome = await deliver(client, item) }
    catch (error) { log.error('Draft notification delivery failed', { outbox_id: item.id, error: serializeError(error) }) }
    // Do not persist provider URLs, tokens, or raw response bodies.
    const { data: acknowledged, error: ackError } = await client.rpc('finish_draft_notification', {
      p_id: item.id, p_lease_token: item.lease_token, p_outcome: outcome,
      p_error: outcome === 'retry' ? 'Delivery failed; check correlated worker logs' : null,
    })
    if (ackError || !acknowledged) {
      log.error('Draft notification acknowledgement failed', { outbox_id: item.id, error: serializeError(ackError) })
      return `Unacknowledged notification ${item.id}`
    }
    return outcome === 'retry' ? `Failed notification ${item.id}` : null
  }))
  const errors = results.filter((result): result is string => result !== null)
  return { processed: items.length, failed: errors.length, errors }
}

export async function processDraftNotifications(client: SupabaseClient, deliver = deliverDraftNotification) {
  const deadline = Date.now() + 25_000
  const total = { processed: 0, failed: 0, errors: [] as string[] }
  // The database leases only the oldest pending event per channel. Drain healthy
  // channels in order, while a failed channel waits for its scheduled retry.
  // Leave time for the final bounded webhook request before the cron's 60s limit.
  for (let batch = 0; batch < 10 && Date.now() < deadline; batch++) {
    const result = await processBatch(client, deliver)
    total.processed += result.processed
    total.failed += result.failed
    total.errors.push(...result.errors)
    if (result.processed === 0) break
  }
  return total
}
