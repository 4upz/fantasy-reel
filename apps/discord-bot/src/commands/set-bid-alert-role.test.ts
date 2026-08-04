import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction, failNthQuery } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { setBidAlertRole } from './set-bid-alert-role.js'

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
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await setBidAlertRole.execute(interaction)

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true })
  })

  it('replies with a friendly message when the channel is not linked', async () => {
    mockSupabase({ tables: { discord_channels: { data: null } } })
    const interaction = makeInteraction()

    await setBidAlertRole.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not linked to a league'))
  })

  it('denies members without Manage Server, the admin role, or league ownership', async () => {
    mockSupabase({
      tables: { discord_channels: linkedChannel },
      rpc: { get_user_by_discord_id: { data: 'someone-else' } },
    })
    const interaction = makeInteraction({ memberRoleIds: ['unrelated-role'] })

    await setBidAlertRole.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Manage Server'))
  })

  it('allows a bot-admin-role holder to set the alert role', async () => {
    const client = mockSupabase({ tables: { discord_channels: linkedChannel } })
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
    const client = mockSupabase({
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
    const client = mockSupabase({ tables: { discord_channels: linkedChannel } })
    // Second discord_channels query is the update; make it fail.
    failNthQuery(client, 'discord_channels', 2)

    const interaction = makeInteraction({ hasManageGuild: true })

    await setBidAlertRole.execute(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed to update the bid alert role'))
  })
})
