import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS } from '../utils/embeds.js'
import { canAdministerBot, ADMIN_DENIED_MESSAGE } from '../utils/permissions.js'
import type { Command } from './index.js'

export const removeLeague: Command = {
  data: new SlashCommandBuilder()
    .setName('remove-league')
    .setDescription('Unlink the Fantasy Reel league from this channel') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()

    // Find the channel link
    const { data: channelLink, error: findError } = await supabase
      .from('discord_channels')
      .select('id, league_id, webhook_id, created_by, bot_admin_role_id, leagues(name, owner_id)')
      .eq('channel_id', interaction.channelId)
      .maybeSingle()

    if (findError || !channelLink) {
      await interaction.editReply('This channel is not linked to any league.')
      return
    }

    // Resolve Discord user to Supabase user
    const { data: userId, error: userError } = await supabase.rpc(
      'get_user_by_discord_id',
      { p_discord_id: interaction.user.id }
    )

    if (userError || !userId) {
      await interaction.editReply('Could not verify your identity. Link your Discord account first.')
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

    // Delete the webhook
    if (channelLink.webhook_id) {
      try {
        const webhooks = await interaction.guild?.fetchWebhooks()
        const webhook = webhooks?.find((w) => w.id === channelLink.webhook_id)
        if (webhook) await webhook.delete('League unlinked')
      } catch (error) {
        console.error('Failed to delete webhook:', error)
        // Continue with unlinking even if webhook deletion fails
      }
    }

    // Delete the discord_channels record
    const { error: deleteError } = await supabase
      .from('discord_channels')
      .delete()
      .eq('id', channelLink.id)

    if (deleteError) {
      console.error('Failed to delete discord_channels:', deleteError)
      await interaction.editReply('Failed to unlink league. Please try again.')
      return
    }

    const leagueName = league?.name || 'the league'
    const embed = createBaseEmbed(leagueName, channelLink.league_id)
      .setTitle('League Unlinked')
      .setDescription(`This channel is no longer linked to **${leagueName}**.`)
      .setColor(DISCORD_COLORS.crimson)
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })
  },
}
