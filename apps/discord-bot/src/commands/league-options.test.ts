import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { leagueOptions } from './league-options.js'

const linkedChannel = {
  data: { league_id: 'league-1', leagues: { name: 'Blockbusters', status: 'active' } },
}

describe('/league-options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await leagueOptions.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('shows full league settings', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        leagues: {
          data: {
            invite_only: true,
            max_participants: 8,
            draft_slots: 5,
            total_slots: 8,
            drop_limit: 2,
            counterbid_hours: 24,
            draft_counterpick_slots: 1,
            bidding_counterpick_slots: 0,
            counterpicks_block_drops: true,
            faab_budget: 100,
            trades_enabled: true,
            trade_review_enabled: true,
            trade_veto_hours: 24,
            trade_deadline: null,
          },
        },
      },
    })
    const interaction = makeInteraction()

    await leagueOptions.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.title).toBe('League Settings')
    expect(embed.description).toContain('Invite only: On')
    expect(embed.description).toContain('Rounds: 5')
    expect(embed.description).toContain('Fantasy budget: $100')
    expect(embed.description).not.toContain('undefined')
    // Sensitive: join_code must never be exposed via the bot
    expect(embed.description).not.toContain('join_code')
  })

  it('shows an empty/default settings state gracefully', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        leagues: {
          data: {
            invite_only: false,
            max_participants: null,
            draft_slots: null,
            total_slots: null,
            drop_limit: null,
            counterbid_hours: null,
            draft_counterpick_slots: 0,
            bidding_counterpick_slots: 0,
            counterpicks_block_drops: false,
            faab_budget: null,
            trades_enabled: false,
            trade_review_enabled: false,
            trade_veto_hours: null,
            trade_deadline: null,
          },
        },
      },
    })
    const interaction = makeInteraction()

    await leagueOptions.execute(interaction)

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data
    expect(embed.description).toContain('Max participants: Unlimited')
  })

  it('replies with a friendly error when Supabase fails', async () => {
    mockSupabase({
      tables: {
        discord_channels: linkedChannel,
        leagues: { data: null, error: { message: 'db down' } },
      },
    })
    const interaction = makeInteraction()

    await leagueOptions.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load league settings'))
  })
})
