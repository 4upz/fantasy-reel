import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { resolveLinkedLeague, UNLINKED_CHANNEL_MESSAGE } from '../utils/channel-league.js'
import { browseMovies } from '../utils/functions-client.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const TOP_N = 10

interface TmdbIdRow {
  movies: { tmdb_id?: number } | null
}

export const topAvailable: Command = {
  data: new SlashCommandBuilder()
    .setName('top-available')
    .setDescription('Show the top unrostered upcoming movies in this league') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await resolveLinkedLeague(supabase, interaction.channelId)

    if (!linked) {
      await interaction.editReply(UNLINKED_CHANNEL_MESSAGE)
      return
    }

    const { leagueId, leagueName } = linked

    const { data: draftRows, error: draftError } = await supabase
      .from('draft_picks')
      .select('movies(tmdb_id)')
      .eq('league_id', leagueId)
      .is('dropped_at', null)
      .returns<TmdbIdRow[]>()

    const { data: pickupRows, error: pickupError } = await supabase
      .from('pickups')
      .select('movies(tmdb_id)')
      .eq('league_id', leagueId)
      .is('dropped_at', null)
      .returns<TmdbIdRow[]>()

    if (draftError || pickupError) {
      console.error('Failed to fetch rostered movies:', draftError || pickupError)
      await interaction.editReply('Failed to load top available movies. Please try again.')
      return
    }

    const rosteredTmdbIds = new Set(
      [...(draftRows || []), ...(pickupRows || [])]
        .map((r) => r.movies?.tmdb_id)
        .filter((id): id is number => id != null)
    )

    const { data: browseData, error: fetchError } = await browseMovies({ release_window: 'quarter', sort_by: 'popularity' })

    if (fetchError || !browseData) {
      console.error('Failed to fetch movie data:', fetchError)
      await interaction.editReply('Failed to load movie data. Please try again.')
      return
    }

    const available = browseData.results.filter((m) => !rosteredTmdbIds.has(m.tmdb_id)).slice(0, TOP_N)

    if (available.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle('Top Available Movies')
        .setDescription('No available movies found.')
        .setColor(DISCORD_COLORS.blue)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const lines = available.map((movie, index) => {
      const title = truncate(movie.title, 40)
      const date = movie.release_date
        ? new Date(movie.release_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'TBD'
      return `${index + 1}. **${title}** -- ${date}`
    })

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle('Top Available Movies')
      .setDescription(lines.join('\n'))
      .setColor(DISCORD_COLORS.gold)
      .setURL(leagueUrl(leagueId, '/bidding'))
      .setThumbnail(available[0].poster_url)

    await interaction.editReply({ embeds: [embed] })
  },
}
