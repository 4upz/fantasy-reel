import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS } from '../utils/embeds.js'
import { UNLINKED_CHANNEL_MESSAGE } from '../utils/channel-league.js'
import { canAdministerBot, ADMIN_DENIED_MESSAGE } from '../utils/permissions.js'
import type { Command } from './index.js'

interface ChannelLinkRow {
  id: string
  league_id: string
  bot_admin_role_id: string | null
  leagues?: { name?: string; owner_id?: string }
}

export const setBotAdminRole: Command = {
  data: new SlashCommandBuilder()
    .setName('set-bot-admin-role')
    .setDescription('Set (or clear) the role allowed to administer the bot in this channel')
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Role to grant bot-admin access -- omit to clear')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })

    const supabase = getSupabase()

    const { data: channelLink, error: findError } = await supabase
      .from('discord_channels')
      .select('id, league_id, bot_admin_role_id, leagues(name, owner_id)')
      .eq('channel_id', interaction.channelId)
      .maybeSingle<ChannelLinkRow>()

    if (findError || !channelLink) {
      await interaction.editReply(UNLINKED_CHANNEL_MESSAGE)
      return
    }

    const league = channelLink.leagues
    const leagueName = league?.name || 'League'

    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: channelLink.bot_admin_role_id,
      league_owner_id: league?.owner_id,
    })

    if (!allowed) {
      await interaction.editReply(ADMIN_DENIED_MESSAGE)
      return
    }

    const role = interaction.options.getRole('role')

    const { error: updateError } = await supabase
      .from('discord_channels')
      .update({ bot_admin_role_id: role?.id ?? null })
      .eq('id', channelLink.id)

    if (updateError) {
      console.error('Failed to update bot admin role:', updateError)
      await interaction.editReply('Failed to update the bot-admin role. Please try again.')
      return
    }

    const embed = createBaseEmbed(leagueName, channelLink.league_id)
      .setTitle('Bot Admin Role Updated')
      .setDescription(
        role
          ? `Members with the **${role.name}** role can now administer the bot in this channel.`
          : 'The bot-admin role has been cleared. Only Manage Server permission holders and the league owner can administer the bot here.'
      )
      .setColor(DISCORD_COLORS.gold)

    await interaction.editReply({ embeds: [embed] })
  },
}
