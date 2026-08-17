import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { requireLinkedLeague } from '../utils/channel-league.js'
import { fetchTeamHoldings } from '../utils/roster.js'
import { truncate } from '../utils/format.js'
import type { Command } from './index.js'

const COMPACT_THRESHOLD = 8

const HOLDING_FIELDS = 'movie_id, title, release_date, fantasy_points'

interface RosterRow {
  movie_id: string
  title: string | null
  release_date: string | null
  fantasy_points: number | null
}

interface ReviewRow {
  movie_id: string
  source: string | null
  score: number | null
}

/**
 * Critic scores per movie, as `"source: score"` strings for the full
 * (non-compact) roster line. `team_holdings` is denormalized and carries no
 * `reviews` embed, so this is a separate lookup -- only made when the roster is
 * short enough to show them.
 */
async function fetchScoresByMovie(
  supabase: ReturnType<typeof getSupabase>,
  movieIds: string[]
): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from('reviews')
    .select('movie_id, source, score')
    .in('movie_id', movieIds)
    .returns<ReviewRow[]>()

  const byMovie = new Map<string, string[]>()
  for (const review of data || []) {
    if (review.score == null) continue
    const scores = byMovie.get(review.movie_id) || []
    scores.push(`${review.source}: ${review.score}`)
    byMovie.set(review.movie_id, scores)
  }

  return byMovie
}

export const roster: Command = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View a team\'s movie roster')
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('Team name')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const teamNameInput = interaction.options.getString('team', true)
    const supabase = getSupabase()

    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName } = linked

    // Find team by name (case-insensitive) within this league
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, league_participants!inner(league_id)')
      .eq('league_participants.league_id', leagueId)
      .ilike('name', teamNameInput)

    if (teamsError || !teams || teams.length === 0) {
      await interaction.editReply(
        `Team "${teamNameInput}" not found in this league.`
      )
      return
    }

    const team = teams[0]

    const { data: rosterRows, error: rosterError } = await fetchTeamHoldings<RosterRow>(
      supabase,
      team.id,
      HOLDING_FIELDS
    )

    if (rosterError) {
      console.error('Failed to fetch roster:', rosterError)
      await interaction.editReply('Failed to load roster. Please try again.')
      return
    }

    if (rosterRows.length === 0) {
      const embed = createBaseEmbed(leagueName, leagueId)
        .setTitle(team.name)
        .setDescription('No movies yet.')
        .setColor(DISCORD_COLORS.gold)

      await interaction.editReply({ embeds: [embed] })
      return
    }

    const isCompact = rosterRows.length >= COMPACT_THRESHOLD
    const scoresByMovie = isCompact
      ? new Map<string, string[]>()
      : await fetchScoresByMovie(supabase, rosterRows.map((row) => row.movie_id))

    const lines = rosterRows.map((row) => {
      const title = truncate(row.title || 'Untitled', 40)
      const pointsStr = row.fantasy_points != null ? `${row.fantasy_points} pts` : 'Unreleased'

      if (isCompact) {
        return `**${title}** -- ${pointsStr}`
      }

      // Full format: two lines
      const releaseDate = row.release_date
        ? new Date(row.release_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : 'TBD'

      const scoreDetails = scoresByMovie.get(row.movie_id)?.join(' | ')
      const secondLine = scoreDetails
        ? `  Opens ${releaseDate} -- ${scoreDetails}`
        : `  Opens ${releaseDate}`

      return `**${title}** -- ${pointsStr}\n${secondLine}`
    })

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle(team.name)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor(DISCORD_COLORS.gold)
      .setURL(leagueUrl(leagueId))
      .setFooter({ text: `${rosterRows.length} movies -- ${leagueName}` })

    await interaction.editReply({ embeds: [embed] })
  },
}
