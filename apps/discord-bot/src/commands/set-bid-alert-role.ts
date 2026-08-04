import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS } from '../utils/embeds.js'
import { requireAdministrableChannel } from '../utils/permissions.js'
import type { Command } from './index.js'

export const setBidAlertRole: Command = {
  data: new SlashCommandBuilder()
    .setName('set-bid-alert-role')
    .setDescription('Set (or clear) the role pinged for bid notifications in this channel')
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Role to ping for bid alerts -- omit to clear')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })

    const supabase = getSupabase()
    const administrable = await requireAdministrableChannel(interaction, supabase)
    if (!administrable) return

    const { channel, leagueName } = administrable
    const role = interaction.options.getRole('role')

    const { error: updateError } = await supabase
      .from('discord_channels')
      .update({ bid_alert_role_id: role?.id ?? null })
      .eq('id', channel.id)

    if (updateError) {
      console.error('Failed to update bid alert role:', updateError)
      await interaction.editReply('Failed to update the bid alert role. Please try again.')
      return
    }

    const embed = createBaseEmbed(leagueName, channel.league_id)
      .setTitle('Bid Alert Role Updated')
      .setDescription(
        role
          ? `**${role.name}** will be pinged on new bid activity in this channel.`
          : 'Bid alert pings have been cleared for this channel.'
      )
      .setColor(DISCORD_COLORS.gold)

    await interaction.editReply({ embeds: [embed] })
  },
}
