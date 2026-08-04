import {
  ChannelType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { config } from '../config.js'
import { createBaseEmbed, DISCORD_COLORS, FANTASY_REEL_ICON } from '../utils/embeds.js'
import { canAdministerBot, ADMIN_DENIED_MESSAGE } from '../utils/permissions.js'
import type { Command } from './index.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseLeagueId(input: string): string | null {
  // Try extracting UUID from a URL like /league/{uuid}
  const urlMatch = input.match(/\/league\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (urlMatch) return urlMatch[1]

  // Try raw UUID
  if (UUID_REGEX.test(input)) return input

  return null
}

export const setLeague: Command = {
  data: new SlashCommandBuilder()
    .setName('set-league')
    .setDescription('Link a Fantasy Reel league to this channel')
    .addStringOption((option) =>
      option
        .setName('league')
        .setDescription('League URL or ID')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const input = interaction.options.getString('league', true)
    const leagueId = parseLeagueId(input)

    if (!leagueId) {
      await interaction.editReply(
        'Invalid league URL or ID. Provide a league page URL or UUID.'
      )
      return
    }

    const supabase = getSupabase()

    // Resolve Discord user to Supabase user
    const { data: userId, error: userError } = await supabase.rpc(
      'get_user_by_discord_id',
      { p_discord_id: interaction.user.id }
    )

    if (userError || !userId) {
      await interaction.editReply(
        `Link your Discord account to Fantasy Reel first at ${config.appUrl}/settings`
      )
      return
    }

    // Verify league membership
    const { data: participant, error: participantError } = await supabase
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    if (participantError || !participant) {
      await interaction.editReply(
        'You must be an active member of this league to link it.'
      )
      return
    }

    // Check if channel is already linked
    const { data: existing } = await supabase
      .from('discord_channels')
      .select('id, league_id, leagues(name)')
      .eq('channel_id', interaction.channelId)
      .maybeSingle()

    if (existing) {
      const linkedName = (existing as { leagues?: { name?: string } }).leagues?.name || 'a league'
      await interaction.editReply(
        `This channel is already linked to **${linkedName}**. Use /remove-league first.`
      )
      return
    }

    // Get league name and owner
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('name, owner_id')
      .eq('id', leagueId)
      .single()

    if (leagueError || !league) {
      await interaction.editReply('League not found.')
      return
    }

    // Only bot admins (Manage Server, the bot-admin role, or the league owner)
    // may link a channel -- there's no discord_channels row yet, so the
    // per-channel role grant doesn't apply here.
    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: null,
      league_owner_id: league.owner_id,
    })

    if (!allowed) {
      await interaction.editReply(ADMIN_DENIED_MESSAGE)
      return
    }

    // Create webhook
    const channel = interaction.channel
    const allowedTypes = new Set([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    ])
    if (!channel || !allowedTypes.has(channel.type)) {
      await interaction.editReply(
        'This command must be run in a text, announcement, or thread/post channel.'
      )
      return
    }

    // Threads/forum posts can't create webhooks directly — use the parent channel
    const webhookChannel = channel.isThread() ? channel.parent : channel
    if (!webhookChannel || !('createWebhook' in webhookChannel)) {
      await interaction.editReply('Could not access the parent channel to create a webhook.')
      return
    }

    let webhook
    try {
      webhook = await webhookChannel.createWebhook({
        name: 'Fantasy Reel',
        avatar: FANTASY_REEL_ICON,
      })
    } catch {
      await interaction.editReply(
        'Failed to create webhook. Make sure the bot has Manage Webhooks permission in this channel.'
      )
      return
    }

    // For threads/forum posts, store the thread ID so webhook sends target it
    const threadId = channel.isThread() ? interaction.channelId : null

    // Insert discord_channels record
    const { error: insertError } = await supabase
      .from('discord_channels')
      .insert({
        league_id: leagueId,
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
        webhook_id: webhook.id,
        webhook_url: webhook.url,
        thread_id: threadId,
        created_by: userId,
      })

    if (insertError) {
      // Clean up the webhook since we failed to save
      await webhook.delete().catch(console.error)
      console.error('Failed to insert discord_channels:', insertError)
      await interaction.editReply('Failed to link league. Please try again.')
      return
    }

    // Reply with success embed
    const embed = createBaseEmbed(league.name, leagueId)
      .setTitle('League Linked')
      .setDescription(
        `This channel is now linked to **${league.name}**.\n\n` +
        `Notifications for drafts, bids, trades, and score updates will appear here.`
      )
      .setColor(DISCORD_COLORS.gold)
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })

    // Send welcome message via webhook
    const welcomeEmbed = new EmbedBuilder()
      .setAuthor({
        name: league.name,
        iconURL: FANTASY_REEL_ICON,
        url: `${config.appUrl}/league/${leagueId}`,
      })
      .setTitle('Fantasy Reel Notifications Active')
      .setDescription(
        'This channel will receive notifications for:\n\n' +
        '- Draft picks\n' +
        '- Bid updates (new bids, outbids, results)\n' +
        '- Trade proposals and resolutions\n' +
        '- Score updates\n\n' +
        `Use \`/standings\` to check the leaderboard and \`/roster\` to view a team's movies.`
      )
      .setColor(DISCORD_COLORS.blue)
      .setFooter({ text: 'Use /configure to customize which notifications appear.' })

    try {
      await webhook.send({ embeds: [welcomeEmbed], ...(threadId && { threadId }) })
    } catch (error) {
      console.error('Failed to send welcome webhook message:', error)
    }
  },
}
