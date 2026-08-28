import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js'
import { getSupabase } from '../supabase.js'
import { createBaseEmbed, DISCORD_COLORS, leagueUrl } from '../utils/embeds.js'
import { championTeamIds, requireLinkedLeague, seasonLabel } from '../utils/channel-league.js'
import type { Command } from './index.js'

interface StandingsRow {
  user_id: string | null
  profiles: { display_name?: string | null } | null
  teams: {
    id: string
    name: string
    team_scores: {
      total_points: number | null
      movies_scored: number | null
      movies_pending: number | null
      last_calculated_at: string | null
    } | null
  } | null
}

const PRE_STANDINGS_STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  drafting: 'Drafting',
  counterpicking: 'Counterpicking',
}

function formatPoints(points: number): string {
  return `${Math.round(points * 10) / 10}`
}

function totalPoints(participant: StandingsRow): number {
  return participant.teams?.team_scores?.total_points ?? 0
}

/** Standings shell used for the info-only replies (pre-draft, no teams). */
function noticeEmbed(leagueName: string, leagueId: string, description: string): EmbedBuilder {
  return createBaseEmbed(leagueName, leagueId)
    .setTitle('Standings')
    .setDescription(description)
    .setColor(DISCORD_COLORS.blue)
}

export const standings: Command = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show league standings for this channel') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply()

    const supabase = getSupabase()
    const linked = await requireLinkedLeague(interaction, supabase)
    if (!linked) return

    const { leagueId, leagueName, leagueStatus, seasonYear } = linked
    const season = seasonLabel(seasonYear)

    // Standings only exist once the draft is done (mirrors the web app)
    const preStandingsLabel = PRE_STANDINGS_STATUS_LABELS[leagueStatus]
    if (preStandingsLabel) {
      const embed = noticeEmbed(
        leagueName,
        leagueId,
        `Standings will be available once the draft completes.\n\nLeague status: **${preStandingsLabel}**` +
          (season ? `\nSeason: **${season}**` : '')
      )

      await interaction.editReply({ embeds: [embed] })
      return
    }

    // All active teams in the league, with their score row if one exists yet
    const { data: participants, error: participantsError } = await supabase
      .from('league_participants')
      .select(`
        user_id,
        profiles(display_name),
        teams(
          id,
          name,
          team_scores(total_points, movies_scored, movies_pending, last_calculated_at)
        )
      `)
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .returns<StandingsRow[]>()

    if (participantsError) {
      console.error('Failed to fetch standings:', participantsError)
      await interaction.editReply('Failed to load standings. Please try again.')
      return
    }

    const sorted = (participants || [])
      .filter((p) => p.teams != null)
      .sort((a, b) => totalPoints(b) - totalPoints(a))

    if (sorted.length === 0) {
      const embed = noticeEmbed(leagueName, leagueId, 'No teams in this league yet.')

      await interaction.editReply({ embeds: [embed] })
      return
    }

    // Resolve invoker's user ID for the "(you)" indicator; a failure here
    // should never block showing standings.
    const { data: invokerUserId } = await supabase.rpc('get_user_by_discord_id', {
      p_discord_id: interaction.user.id,
    })

    const isFinal = leagueStatus === 'completed'

    // On a finished season the champions are whoever the season recorded, not
    // whoever sorts first now: the two agree today, but winner_team_ids is the
    // written-down answer and it is what survives a later rescore. It also
    // carries co-champions, which a rank comparison would have to re-derive.
    //
    // Null means the season finished before winners were recorded, so the
    // rank-1 fallback below stands in.
    const champions = championTeamIds(linked)

    // Tied teams share a rank (1, 1, 3 -- like the web standings page)
    let currentRank = 0
    let previousPoints: number | null = null
    const lines = sorted.map((participant, index) => {
      const scores = participant.teams!.team_scores
      const points = totalPoints(participant)
      if (points !== previousPoints) {
        currentRank = index + 1
        previousPoints = points
      }

      const teamName = participant.teams!.name || 'Unknown Team'
      const ownerName = participant.profiles?.display_name
      const nameDisplay = ownerName ? `${teamName} (${ownerName})` : teamName

      const isChampion = isFinal && (
        champions ? champions.has(participant.teams!.id) : currentRank === 1
      )
      const emphasizedName = isChampion ? `__**${nameDisplay}**__` : `**${nameDisplay}**`
      const youMarker =
        invokerUserId && participant.user_id === invokerUserId ? ' *(you)*' : ''
      const trophy = isChampion ? ' 🏆' : ''

      const moviesScored = scores?.movies_scored ?? 0
      const moviesTotal = moviesScored + (scores?.movies_pending ?? 0)
      const moviesSummary =
        moviesTotal > 0
          ? `${moviesScored}/${moviesTotal} movies scored`
          : 'no movies scored yet'

      return (
        `**${currentRank}.** ${emphasizedName}${youMarker}${trophy}\n` +
        `> **${formatPoints(points)} pts** -- ${moviesSummary}`
      )
    })

    const lastCalculatedAt = sorted
      .map((p) => p.teams!.team_scores?.last_calculated_at)
      .filter((d): d is string => d != null)
      .sort()
      .pop()
    const footerTimestamp = lastCalculatedAt
      ? `Scores updated ${new Date(lastCalculatedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`
      : 'Scores not yet calculated'

    const embed = createBaseEmbed(leagueName, leagueId)
      .setTitle(isFinal ? 'Final Standings' : 'Standings')
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor(DISCORD_COLORS.blue)
      .setURL(leagueUrl(leagueId, '/standings'))
      .setFooter({
        text: [footerTimestamp, leagueName, season].filter(Boolean).join(' -- '),
      })

    await interaction.editReply({ embeds: [embed] })
  },
}
