import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS } from '../utils/embeds.js'
import { canAdministerBot, ADMIN_DENIED_MESSAGE } from '../utils/permissions.js'
import type { Command } from './index.js'

type ToggleField =
  | 'notify_drafts'
  | 'notify_bids'
  | 'notify_trades'
  | 'notify_scores'
  | 'notify_weekly_digest'
  | 'notify_movie_news'

interface ChannelSettings {
  id: string
  league_id: string
  notify_drafts: boolean
  notify_bids: boolean
  notify_trades: boolean
  notify_scores: boolean
  notify_weekly_digest: boolean
  notify_movie_news: boolean
  bot_admin_role_id: string | null
  created_by: string
  leagues?: { name?: string; owner_id?: string }
}

const TOGGLE_MAP: Record<string, ToggleField> = {
  toggle_drafts: 'notify_drafts',
  toggle_bids: 'notify_bids',
  toggle_trades: 'notify_trades',
  toggle_scores: 'notify_scores',
  toggle_weekly_digest: 'notify_weekly_digest',
  toggle_movie_news: 'notify_movie_news',
}

function buildSettingsEmbed(settings: ChannelSettings, leagueName: string) {
  const on = 'On'
  const off = 'Off'

  return createBaseEmbed(leagueName, settings.league_id)
    .setTitle('Notification Settings')
    .setDescription(
      `Configure which notifications appear in this channel.\n\n` +
      `**Drafts:** ${settings.notify_drafts ? on : off}\n` +
      `**Bids:** ${settings.notify_bids ? on : off}\n` +
      `**Trades:** ${settings.notify_trades ? on : off}\n` +
      `**Scores:** ${settings.notify_scores ? on : off}\n` +
      `**Weekly Digest:** ${settings.notify_weekly_digest ? on : off}\n` +
      `**Movie News:** ${settings.notify_movie_news ? on : off}`
    )
    .setColor(DISCORD_COLORS.gold)
}

function toggleButton(customId: string, label: string, enabled: boolean) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(`${label}: ${enabled ? 'On' : 'Off'}`)
    .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
}

function buildButtonRows(settings: ChannelSettings) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      toggleButton('toggle_drafts', 'Drafts', settings.notify_drafts),
      toggleButton('toggle_bids', 'Bids', settings.notify_bids),
      toggleButton('toggle_trades', 'Trades', settings.notify_trades),
      toggleButton('toggle_scores', 'Scores', settings.notify_scores)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      toggleButton('toggle_weekly_digest', 'Weekly Digest', settings.notify_weekly_digest),
      toggleButton('toggle_movie_news', 'Movie News', settings.notify_movie_news)
    ),
  ]
}

export const configure: Command = {
  data: new SlashCommandBuilder()
    .setName('configure')
    .setDescription('Configure league notification settings for this channel') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()

    // Find channel link
    const { data: channelLink, error: findError } = await supabase
      .from('discord_channels')
      .select(
        'id, league_id, notify_drafts, notify_bids, notify_trades, notify_scores, notify_weekly_digest, notify_movie_news, bot_admin_role_id, created_by, leagues(name, owner_id)'
      )
      .eq('channel_id', interaction.channelId)
      .maybeSingle()

    if (findError || !channelLink) {
      await interaction.editReply(
        'This channel is not linked to a league. Use /set-league first.'
      )
      return
    }

    // Resolve Discord user to Supabase user
    const { data: userId, error: userError } = await supabase.rpc(
      'get_user_by_discord_id',
      { p_discord_id: interaction.user.id }
    )

    if (userError || !userId) {
      await interaction.editReply(
        'Could not verify your identity. Link your Discord account first.'
      )
      return
    }

    // Verify the user linked it, or can otherwise administer the bot here
    // (Manage Server, the bot-admin role, or the league owner).
    const league = (channelLink as { leagues?: { name?: string; owner_id?: string } }).leagues
    const isLinker = channelLink.created_by === userId

    if (!isLinker) {
      const allowed = await canAdministerBot(interaction, {
        bot_admin_role_id: channelLink.bot_admin_role_id,
        league_owner_id: league?.owner_id,
      })

      if (!allowed) {
        await interaction.editReply(ADMIN_DENIED_MESSAGE)
        return
      }
    }

    const settings: ChannelSettings = {
      id: channelLink.id,
      league_id: channelLink.league_id,
      notify_drafts: channelLink.notify_drafts,
      notify_bids: channelLink.notify_bids,
      notify_trades: channelLink.notify_trades,
      notify_scores: channelLink.notify_scores,
      notify_weekly_digest: channelLink.notify_weekly_digest,
      notify_movie_news: channelLink.notify_movie_news,
      bot_admin_role_id: channelLink.bot_admin_role_id,
      created_by: channelLink.created_by,
      leagues: league,
    }
    const leagueName = league?.name || 'League'

    const reply = await interaction.editReply({
      embeds: [buildSettingsEmbed(settings, leagueName)],
      // Type assertion: discord-api-types version mismatch between discord.js sub-packages
      components: buildButtonRows(settings) as never,
    })

    // Collect button interactions for 15 minutes
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15 * 60 * 1000,
      filter: (i) => i.user.id === interaction.user.id,
    })

    collector.on('collect', async (buttonInteraction) => {
      const field = TOGGLE_MAP[buttonInteraction.customId]
      if (!field) return

      await buttonInteraction.deferUpdate()

      settings[field] = !settings[field]

      // Update database
      const { error: updateError } = await supabase
        .from('discord_channels')
        .update({ [field]: settings[field] })
        .eq('id', settings.id)

      if (updateError) {
        console.error('Failed to update setting:', updateError)
        settings[field] = !settings[field] // Revert on failure
      }

      await interaction.editReply({
        embeds: [buildSettingsEmbed(settings, leagueName)],
        components: buildButtonRows(settings) as never,
      })
    })

    collector.on('end', async () => {
      // Disable buttons when collector expires
      const disabledRows = buildButtonRows(settings).map((row) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...row.components.map((b) => ButtonBuilder.from(b.toJSON() as never).setDisabled(true))
        )
      )
      await interaction.editReply({ components: disabledRows as never }).catch(console.error)
    })
  },
}
