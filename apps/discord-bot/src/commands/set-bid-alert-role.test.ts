import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabaseClient, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { getSupabase } from '../supabase.js'
import { setBidAlertRole } from './set-bid-alert-role.js'

function setSupabase(config: Parameters<typeof createMockSupabaseClient>[0]) {
  const client = createMockSupabaseClient(config)
  ;(getSupabase as unknown as Mock).mockReturnValue(client)
  return client
}

const linkedChannel = {
  data: {
    id: 'channel-row-1',
    league_id: 'league-1',
    bot_admin_role_id: 'role-admin',
    leagues: { name: 'Blockbusters', owner_id: 'user-1' },
  },
}

describe('/set-bid-alert-role', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defers ephemerally', async () => {
    setSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await setBidAlertRole.execute(interaction)

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true })
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    setSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await setBidAlertRole.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('denies members without Manage Server, the admin role, or league ownership', async () => {
    setSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'someone-else' } },
    })
    const interaction = makeInteraction({ memberRoleIds: ['unrelated-role'] })

    await setBidAlertRole.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Manage Server'))
  })

  it('allows a bot-admin-role holder to set the alert role', async () => {
    const client = setSupabase({ tables: { discord_channels: linkedChannel } })
    const interaction = makeInteraction({
      memberRoleIds: ['role-admin'],
      roleOptions: { role: { id: 'role-hype', name: 'Bid Alerts' } },
    })

    await setBidAlertRole.execute(interaction)

    expect(client.getBuilder('discord_channels', 1).update).toHaveBeenCalledWith({ bid_alert_role_id: 'role-hype' })
    const payload = interaction.editReply.mock.calls[0][0]
    expect(payload.embeds[0].data.description).toContain('Bid Alerts')
  })

  it('allows the league owner to clear the alert role', async () => {
    const client = setSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'user-1' } },
    })
    const interaction = makeInteraction()

    await setBidAlertRole.execute(interaction)

    expect(client.getBuilder('discord_channels', 1).update).toHaveBeenCalledWith({ bid_alert_role_id: null })
    const payload = interaction.editReply.mock.calls[0][0]
    expect(payload.embeds[0].data.description).toContain('cleared')
  })

  it('replies with a friendly error when the update fails', async () => {
    const client = setSupabase({ tables: { discord_channels: linkedChannel } })
    let discordChannelsCalls = 0
    const originalFrom = client.from
    client.from = vi.fn((table: string) => {
      const builder = originalFrom(table)
      if (table === 'discord_channels') {
        discordChannelsCalls++
        if (discordChannelsCalls === 2) {
          builder.eq = vi.fn(() => Promise.resolve({ error: { message: 'db down' } }))
        }
      }
      return builder
    })

    const interaction = makeInteraction({ hasManageGuild: true })

    await setBidAlertRole.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to update the bid alert role'))
  })
})
