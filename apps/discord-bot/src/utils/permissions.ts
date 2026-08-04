import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js'
import { getSupabase } from '../supabase.js'

export const ADMIN_DENIED_MESSAGE =
  'You need the Manage Server permission, the bot-admin role, or to be the league owner to do that.'

export interface AdminCheckChannelSettings {
  bot_admin_role_id: string | null
  league_owner_id: string | null | undefined
}

/**
 * Whether the invoking member has `roleId`, checked defensively against both
 * shapes `interaction.member.roles` can take: a live `GuildMemberRoleManager`
 * (has `.cache`) on gateway-cached members, or a raw `string[]` of role IDs
 * on the API-only interaction payload.
 */
function memberHasRole(interaction: ChatInputCommandInteraction, roleId: string): boolean {
  const roles = (interaction.member as { roles?: unknown } | null)?.roles
  if (Array.isArray(roles)) return roles.includes(roleId)

  const cache = (roles as { cache?: { has?: (id: string) => boolean } } | undefined)?.cache
  return typeof cache?.has === 'function' && cache.has(roleId)
}

/**
 * Whether the invoking member may administer the bot for this channel's
 * league: Manage Server permission, the channel's configured bot-admin role,
 * or being the league owner.
 */
export async function canAdministerBot(
  interaction: ChatInputCommandInteraction,
  channelSettings: AdminCheckChannelSettings
): Promise<boolean> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true
  }

  if (channelSettings.bot_admin_role_id && memberHasRole(interaction, channelSettings.bot_admin_role_id)) {
    return true
  }

  if (!channelSettings.league_owner_id) return false

  const supabase = getSupabase()
  const { data: userId } = await supabase.rpc('get_user_by_discord_id', {
    p_discord_id: interaction.user.id,
  })

  return !!userId && userId === channelSettings.league_owner_id
}
