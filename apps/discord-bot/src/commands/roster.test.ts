import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { roster } from './roster.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

const teamRow = { data: [{ id: 'team-1', name: 'Team One' }] }

function interactionForTeam(team = 'Team One') {
  return makeInteraction({ stringOptions: { team } })
}

describe('/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not linked to a league')
    )
  })

  it('replies when the team is not in this league', async () => {
    mockSupabase({ tables: { discord_channels: linkedChannel, teams: { data: [] } } })
    const interaction = interactionForTeam('Ghost Team')

    await roster.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('"Ghost Team" not found')
    )
  })

  it('lists both drafted movies and pickups', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: teamRow,
        team_holdings: {
          data: [
            { movie_id: 'movie-1', title: 'Drafted Movie', release_date: '2026-09-01', fantasy_points: 20 },
            { movie_id: 'movie-2', title: 'Picked Up Movie', release_date: '2026-10-01', fantasy_points: 5 },
          ],
        },
      },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toContain('Drafted Movie')
    expect(embed.description).toContain('Picked Up Movie')
    expect(embed.footer.text).toContain('2 movies')
  })

  it('shows critic scores alongside short rosters', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: teamRow,
        team_holdings: {
          data: [{ movie_id: 'movie-1', title: 'Drafted Movie', release_date: '2026-09-01', fantasy_points: 20 }],
        },
        reviews: {
          data: [
            { movie_id: 'movie-1', source: 'rotten_tomatoes', score: 88 },
            { movie_id: 'movie-1', source: 'imdb', score: null },
          ],
        },
      },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toContain('rotten_tomatoes: 88')
    expect(embed.description).not.toContain('imdb')
  })

  it('reads holdings from the team_holdings view, never the base tables', async () => {
    const client = mockSupabase({
      tables: { discord_channels: linkedChannel, teams: teamRow, team_holdings: { data: [] } },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    // The view already excludes dropped rows, so there is no dropped_at filter
    // to forget -- but only as long as nobody reintroduces a base-table read.
    expect(client.from).toHaveBeenCalledWith('team_holdings')
    expect(client.from).not.toHaveBeenCalledWith('draft_picks')
    expect(client.from).not.toHaveBeenCalledWith('pickups')
  })

  it('shows an empty roster message when the team holds nothing', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel, teams: teamRow, team_holdings: { data: [] } },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No movies yet.')
  })

  it('replies with a friendly error when the holdings query fails', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: teamRow,
        team_holdings: { data: null, error: { message: 'db down' } },
      },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load roster')
    )
  })
})
