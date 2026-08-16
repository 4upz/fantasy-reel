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
        draft_picks: {
          data: [{ movies: { title: 'Drafted Movie', release_date: '2026-09-01', fantasy_points: 20 } }],
        },
        pickups: {
          data: [{ movies: { title: 'Picked Up Movie', release_date: '2026-10-01', fantasy_points: 5 } }],
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

  it('excludes dropped holdings from both tables', async () => {
    const client = mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: teamRow,
        draft_picks: { data: [] },
        pickups: { data: [] },
      },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    expect(client.getBuilder('draft_picks')?.is).toHaveBeenCalledWith('dropped_at', null)
    expect(client.getBuilder('pickups')?.is).toHaveBeenCalledWith('dropped_at', null)
  })

  it('shows an empty roster message when the team holds nothing', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: teamRow,
        draft_picks: { data: [] },
        pickups: { data: [] },
      },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toBe('No movies yet.')
  })

  it('replies with a friendly error when the pickups query fails', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: teamRow,
        draft_picks: { data: [] },
        pickups: { data: null, error: { message: 'db down' } },
      },
    })
    const interaction = interactionForTeam()

    await roster.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load roster')
    )
  })
})
