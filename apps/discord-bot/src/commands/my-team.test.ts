import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { myTeam } from './my-team.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

describe('/my-team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defers ephemerally', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await myTeam.execute(interaction)

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true })
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await myTeam.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('points to account settings when the Discord account is not linked', async () => {
    mockSupabase({ tables: { discord_channels: linkedChannel }, rpc: { get_user_by_discord_id: { data: null } } })
    const interaction = makeInteraction()

    await myTeam.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('/settings'))
  })

  it('shows the roster, points, and rank for the linked user, scoped to this league server-side', async () => {
    const client = mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        teams: { data: { id: 'team-1', name: 'My Team' } },
        team_scores: {
          data: [
            { total_points: 90, teams: { id: 'team-1', league_participants: { league_id: 'league-1', user_id: 'user-1' } } },
            { total_points: 40, teams: { id: 'team-2', league_participants: { league_id: 'league-1', user_id: 'user-2' } } },
          ],
        },
        team_holdings: {
          data: [{ title: 'Movie One', release_date: '2026-09-01', fantasy_points: 20 }],
        },
      },
      rpc: { get_user_by_discord_id: { data: 'user-1' } },
    })
    const interaction = makeInteraction()

    await myTeam.execute(interaction)

    const payload = interaction.editReply.mock.calls[0][0]
    const embed = payload.embeds[0].data
    expect(embed.title).toBe('My Team')
    expect(embed.description).toContain('Movie One')
    const fields = Object.fromEntries(embed.fields.map((f: { name: string; value: string }) => [f.name, f.value]))
    expect(fields['Total Points']).toBe('90')
    expect(fields['Rank']).toBe('1 of 2')

    // Regression guard: rank/points must be computed from standings scoped
    // to this league server-side, not the whole `team_scores` table.
    expect(client.getBuilder('team_scores')?.eq).toHaveBeenCalledWith(
      'teams.league_participants.league_id',
      'league-1'
    )
  })

  it('replies with a friendly error when Supabase fails', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: null, error: { message: 'db down' } } },
    })
    const interaction = makeInteraction()

    await myTeam.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to look up your account'))
  })
})
