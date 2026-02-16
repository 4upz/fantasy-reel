import { EmbedBuilder } from 'discord.js'
import { config } from '../config.js'

export const DISCORD_COLORS = {
  gold: 0xc9a227,
  green: 0x22c55e,
  crimson: 0xa8505c,
  blue: 0x3b82f6,
  yellow: 0xf59e0b,
} as const

export const FANTASY_REEL_ICON = 'https://fantasy-reel.vercel.app/icon-128.png'

export function createBaseEmbed(leagueName: string, leagueId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({
      name: leagueName,
      iconURL: FANTASY_REEL_ICON,
      url: `${config.appUrl}/league/${leagueId}`,
    })
}

export function leagueUrl(leagueId: string, path = ''): string {
  return `${config.appUrl}/league/${leagueId}${path}`
}
