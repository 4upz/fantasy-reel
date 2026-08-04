import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS } from '../utils/embeds.js'
import { requireAdministrableChannel } from '../utils/permissions.js'
import type { Command } from './index.js'

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
    const administrable = await requireAdministrableChannel(interaction, supabase)
    if (!administrable) return

    const { channel, leagueName } = administrable
    const role = interaction.options.getRole('role')

    const { error: updateError } = await supabase
      .from('discord_channels')
      .update({ bot_admin_role_id: role?.id ?? null })
      .eq('id', channel.id)

    if (updateError) {
      console.error('Failed to update bot admin role:', updateError)
      await interaction.editReply('Failed to update the bot-admin role. Please try again.')
      return
    }

    const embed = createBaseEmbed(leagueName, channel.league_id)
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
