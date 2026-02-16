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
import type { Command } from './index.js'

interface ChannelSettings {
  id: string
  league_id: string
  notify_drafts: boolean
  notify_bids: boolean
  notify_trades: boolean
  notify_scores: boolean
  created_by: string
  leagues?: { name?: string; owner_id?: string }
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
      `**Scores:** ${settings.notify_scores ? on : off}`
    )
    .setColor(DISCORD_COLORS.gold)
}

function buildButtons(settings: ChannelSettings) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('toggle_drafts')
      .setLabel(`Drafts: ${settings.notify_drafts ? 'On' : 'Off'}`)
      .setStyle(settings.notify_drafts ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('toggle_bids')
      .setLabel(`Bids: ${settings.notify_bids ? 'On' : 'Off'}`)
      .setStyle(settings.notify_bids ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('toggle_trades')
      .setLabel(`Trades: ${settings.notify_trades ? 'On' : 'Off'}`)
      .setStyle(settings.notify_trades ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('toggle_scores')
      .setLabel(`Scores: ${settings.notify_scores ? 'On' : 'Off'}`)
      .setStyle(settings.notify_scores ? ButtonStyle.Success : ButtonStyle.Secondary),
  )
}

const TOGGLE_MAP: Record<string, keyof Pick<ChannelSettings, 'notify_drafts' | 'notify_bids' | 'notify_trades' | 'notify_scores'>> = {
  toggle_drafts: 'notify_drafts',
  toggle_bids: 'notify_bids',
  toggle_trades: 'notify_trades',
  toggle_scores: 'notify_scores',
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
      .select('id, league_id, notify_drafts, notify_bids, notify_trades, notify_scores, created_by, leagues(name, owner_id)')
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

    // Verify the user is the linker or league owner
    const league = (channelLink as { leagues?: { name?: string; owner_id?: string } }).leagues
    const isLinker = channelLink.created_by === userId
    const isOwner = league?.owner_id === userId

    if (!isLinker && !isOwner) {
      await interaction.editReply(
        'Only the person who linked this channel or the league owner can configure settings.'
      )
      return
    }

    const settings: ChannelSettings = {
      id: channelLink.id,
      league_id: channelLink.league_id,
      notify_drafts: channelLink.notify_drafts,
      notify_bids: channelLink.notify_bids,
      notify_trades: channelLink.notify_trades,
      notify_scores: channelLink.notify_scores,
      created_by: channelLink.created_by,
      leagues: league,
    }
    const leagueName = league?.name || 'League'

    const reply = await interaction.editReply({
      embeds: [buildSettingsEmbed(settings, leagueName)],
      components: [buildButtons(settings)],
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
        components: [buildButtons(settings)],
      })
    })

    collector.on('end', async () => {
      // Disable buttons when collector expires
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...buildButtons(settings).components.map((b) => ButtonBuilder.from(b).setDisabled(true))
      )
      await interaction.editReply({ components: [disabledRow] }).catch(console.error)
    })
  },
}
