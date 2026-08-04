import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase, makeInteraction } from '../_test/helpers.js'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))

import { canAdministerBot, ADMIN_DENIED_MESSAGE } from './permissions.js'

describe('canAdministerBot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('grants access via Manage Server permission', async () => {
    mockSupabase({ rpc: { get_user_by_discord_id: { data: null } } })
    const interaction = makeInteraction({ hasManageGuild: true })

    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: null,
      league_owner_id: null,
    })

    expect(allowed).toBe(true)
  })

  it('grants access via the bot-admin role', async () => {
    mockSupabase({ rpc: { get_user_by_discord_id: { data: null } } })
    const interaction = makeInteraction({ memberRoleIds: ['role-admin'] })

    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: 'role-admin',
      league_owner_id: null,
    })

    expect(allowed).toBe(true)
  })

  it('grants access to the league owner', async () => {
    mockSupabase({ rpc: { get_user_by_discord_id: { data: 'user-1' } } })
    const interaction = makeInteraction()

    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: null,
      league_owner_id: 'user-1',
    })

    expect(allowed).toBe(true)
  })

  it('denies members with none of the three grants', async () => {
    mockSupabase({ rpc: { get_user_by_discord_id: { data: 'user-2' } } })
    const interaction = makeInteraction({ memberRoleIds: ['some-other-role'] })

    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: 'role-admin',
      league_owner_id: 'user-1',
    })

    expect(allowed).toBe(false)
  })

  it('denies without querying the owner when there is no owner to compare against', async () => {
    const client = mockSupabase({ rpc: { get_user_by_discord_id: { data: 'user-2' } } })
    const interaction = makeInteraction()

    const allowed = await canAdministerBot(interaction, {
      bot_admin_role_id: null,
      league_owner_id: null,
    })

    expect(allowed).toBe(false)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('exposes a shared ephemeral denial message', () => {
    expect(ADMIN_DENIED_MESSAGE).toContain('Manage Server')
  })
})
