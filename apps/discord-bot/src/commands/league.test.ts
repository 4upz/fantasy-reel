import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabaseClient, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { getSupabase } from '../supabase.js'
import { league } from './league.js'

function setSupabase(config: Parameters<typeof createMockSupabaseClient>[0]) {
  const client = createMockSupabaseClient(config)
  ;(getSupabase as unknown as Mock).mockReturnValue(client)
  return client
}

describe('/league', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    setSupabase({ tables: { discord_channels: { data: null, error: null } } })
    const interaction = makeInteraction()

    await league.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('shows the league overview with config and standings, scoped to this league server-side', async () => {
    const client = setSupabase({
      tables: {
        discord_channels: {
          data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
        },
        leagues: {
          data: {
            draft_slots: 5,
            total_slots: 8,
            drop_limit: 2,
            draft_counterpick_slots: 1,
            bidding_counterpick_slots: 0,
            faab_budget: 150,
          },
        },
        league_participants: { data: null, count: 4 },
        team_scores: {
          data: [
            { total_points: 80, teams: { name: 'Team A', league_participants: { league_id: 'league-1' } } },
            { total_points: 60, teams: { name: 'Team B', league_participants: { league_id: 'league-1' } } },
          ],
        },
      },
    })
    const interaction = makeInteraction()

    await league.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledTimes(1)
    const payload = interaction.editReply.mock.calls[0][0]
    const embed = payload.embeds[0].data
    expect(embed.title).toBe('League Overview')
    expect(embed.description).toContain('Active')
    expect(embed.description).toContain('Members:** 4')
    expect(embed.description).toContain('Team A -- 80 pts')
    expect(embed.color).toBe(0xc9a227)

    // Regression guard: standings must be filtered server-side to this
    // league, not fetched whole-table and filtered client-side.
    expect(client.getBuilder('team_scores')?.eq).toHaveBeenCalledWith(
      'teams.league_participants.league_id',
      'league-1'
    )
  })

  it('shows an empty state when there are no standings yet', async () => {
    setSupabase({
      tables: {
        discord_channels: {
          data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'setup' } },
        },
        leagues: {
          data: {
            draft_slots: 5,
            total_slots: 8,
            drop_limit: 2,
            draft_counterpick_slots: 0,
            bidding_counterpick_slots: 0,
            faab_budget: 100,
          },
        },
        league_participants: { data: null, count: 0 },
        team_scores: { data: [] },
      },
    })
    const interaction = makeInteraction()

    await league.execute(interaction)

    const payload = interaction.editReply.mock.calls[0][0]
    expect(payload.embeds[0].data.description).toContain('No standings yet.')
  })

  it('replies with a friendly error when Supabase fails', async () => {
    setSupabase({
      tables: {
        discord_channels: {
          data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
        },
        leagues: { data: null, error: { message: 'db down' } },
      },
    })
    const interaction = makeInteraction()

    await league.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load league info'))
  })
})
