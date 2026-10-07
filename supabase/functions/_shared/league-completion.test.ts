/** Notification orchestration around the atomic completion RPC. Database
 * rollback, scoring and write guards are covered by season_integrity.sql. */
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'
import { completeLeague, type CompleteLeagueResult } from './league-completion.ts'

const LEAGUE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const SERIES_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const USER_A = 'd0000000-0000-4000-8000-00000000000a'
const USER_B = 'd0000000-0000-4000-8000-00000000000b'
const TEAM_A = 'f0000000-0000-4000-8000-00000000000a'
const TEAM_B = 'f0000000-0000-4000-8000-00000000000b'

function setup(tied = false) {
  const standings = [
    { team_id: TEAM_A, team_name: 'Alpha Pictures', participant_id: 'part-a', user_id: USER_A,
      total_points: 84, rank: 1, is_tied: tied },
    { team_id: TEAM_B, team_name: 'Beta Films', participant_id: 'part-b', user_id: USER_B,
      total_points: tied ? 84 : 12, rank: tied ? 1 : 2, is_tied: tied },
  ]
  const result: CompleteLeagueResult = {
    ok: true,
    league: { id: LEAGUE_ID, name: 'Reel Heads', status: 'completed', series_id: SERIES_ID, season_year: 2026 },
    standings, winnerTeamIds: tied ? [TEAM_A, TEAM_B] : [TEAM_A], voidedBids: 3, expiredTrades: 2,
  }
  const db: MockDb = {
    leagues: [],
    league_participants: standings.map((s) => ({ id: s.participant_id, user_id: s.user_id, league_id: LEAGUE_ID, status: 'active' })),
    profiles: [{ user_id: USER_A, display_name: 'Ada' }, { user_id: USER_B, display_name: 'Bo' }],
    discord_channels: [{ id: 'channel-1', league_id: LEAGUE_ID, enabled: true,
      webhook_url: 'https://discord.com/api/webhooks/test', notify_scores: true, consecutive_failures: 0 }],
    notifications: [],
  }
  const client = createMockDbClient(db, { rpc: { complete_league_season: result, log_notification_delivery: null } })
  return { db, client, result }
}

Deno.test('completeLeague', async (t) => {
  Deno.env.delete('RESEND_API_KEY')

  await t.step('announces the committed result and preserves cleanup counts', async () => {
    const { db, client, result } = setup()
    const fetchStub = stubFetch()
    try {
      assertEquals(await completeLeague(client, LEAGUE_ID, { trigger: 'owner' }), result)
      assertEquals(fetchStub.calls.length, 1)
      assertEquals(db.notifications.length, 2)
      assertEquals(db.notifications[0].data.winner_team_ids, [TEAM_A])
      assertStringIncludes(db.notifications[0].body, 'Alpha Pictures takes the title')
      const embeds = fetchStub.calls[0].body.embeds as Array<{ fields: Array<{ name: string }> }>
      assertEquals(embeds[0].fields[0].name, '🥇 Alpha Pictures')
      assertEquals(embeds[0].fields[1].name, '🥈 Beta Films')
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('gives co-champions the same first-place medal', async () => {
    const { db, client } = setup(true)
    const fetchStub = stubFetch()
    try {
      await completeLeague(client, LEAGUE_ID, { trigger: 'owner' })
      assertStringIncludes(db.notifications[0].body, 'Alpha Pictures and Beta Films share the title')
      const embeds = fetchStub.calls[0].body.embeds as Array<{ fields: Array<{ name: string }> }>
      assertEquals(embeds[0].fields.map((f) => f.name), ['🥇 Alpha Pictures', '🥇 Beta Films'])
    } finally {
      fetchStub.restore()
    }
  })

  for (const reason of ['not_found', 'not_active', 'not_due'] as const) {
    await t.step(`${reason} sends no announcement`, async () => {
      const { db } = setup()
      const client = createMockDbClient(db, { rpc: { complete_league_season: { ok: false, reason } } })
      const fetchStub = stubFetch()
      try {
        assertEquals(await completeLeague(client, LEAGUE_ID, { trigger: 'cron' }), { ok: false, reason })
        assertEquals(fetchStub.calls.length, 0)
        assertEquals(db.notifications.length, 0)
      } finally {
        fetchStub.restore()
      }
    })
  }

  await t.step('a transaction error fails the call without an announcement', async () => {
    const { db, client } = setup()
    client.rpc = () => Promise.resolve({ data: null, error: { message: 'score refresh failed' } })
    const fetchStub = stubFetch()
    try {
      await assertRejects(() => completeLeague(client, LEAGUE_ID, { trigger: 'owner' }), Error, 'score refresh failed')
      assertEquals(db.notifications.length, 0)
      assertEquals(fetchStub.calls.length, 0)
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('emails only opted-in players, each with a one-click unsubscribe', async () => {
    const { db, result } = setup()
    const tokenA = 'e0000000-0000-4000-8000-00000000000a'
    let preferencesFor: unknown
    const client = createMockDbClient(db, {
      rpc: {
        complete_league_season: result,
        log_notification_delivery: null,
        ensure_email_preferences: (args?: Record<string, unknown>) => {
          preferencesFor = args?.p_user_ids
          return [
            { user_id: USER_A, season_recap_emails: true, unsubscribe_token: tokenA },
            { user_id: USER_B, season_recap_emails: false, unsubscribe_token: 'e0000000-0000-4000-8000-00000000000b' },
          ]
        },
      },
      users: { [USER_A]: { email: 'ada@example.test' }, [USER_B]: { email: 'bo@example.test' } },
    })
    Deno.env.set('RESEND_API_KEY', 'test-key')
    Deno.env.set('SUPABASE_URL', 'https://api.example.test')
    Deno.env.set('SITE_URL', 'https://www.example.test')
    const fetchStub = stubFetch((url) =>
      url.includes('resend.com') ? Response.json({ id: 'msg-1' }) : undefined
    )
    try {
      await completeLeague(client, LEAGUE_ID, { trigger: 'owner' })
      assertEquals(preferencesFor, [USER_A, USER_B])
      const emails = fetchStub.calls.filter((c) => c.url.includes('resend.com'))
      assertEquals(emails.length, 1)
      assertEquals(emails[0].body.to, ['ada@example.test'])
      assertEquals(emails[0].body.headers, {
        'List-Unsubscribe': `<https://api.example.test/functions/v1/email-unsubscribe?token=${tokenA}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      })
      assertStringIncludes(emails[0].body.html as string, `https://www.example.test/unsubscribe?token=${tokenA}`)
    } finally {
      fetchStub.restore()
      Deno.env.delete('RESEND_API_KEY')
      Deno.env.delete('SITE_URL')
    }
  })

  await t.step('sends no season email when preferences cannot be read', async () => {
    const { db, result } = setup()
    const client = createMockDbClient(db, {
      rpc: { complete_league_season: result, log_notification_delivery: null },
      users: { [USER_A]: { email: 'ada@example.test' } },
    })
    const rpc = client.rpc.bind(client)
    client.rpc = (name: string, args?: Record<string, unknown>) =>
      name === 'ensure_email_preferences'
        ? Promise.resolve({ data: null, error: { message: 'preferences unavailable' } })
        : rpc(name, args)
    Deno.env.set('RESEND_API_KEY', 'test-key')
    const fetchStub = stubFetch()
    try {
      await completeLeague(client, LEAGUE_ID, { trigger: 'owner' })
      assertEquals(fetchStub.calls.filter((c) => c.url.includes('resend.com')).length, 0)
      assertEquals(db.notifications.length, 2)
    } finally {
      fetchStub.restore()
      Deno.env.delete('RESEND_API_KEY')
    }
  })

  await t.step('forwards the cron trigger for the locked deadline recheck', async () => {
    const { client } = setup()
    let request: unknown
    client.rpc = (name: string, args: unknown) => {
      request = { name, args }
      return Promise.resolve({ data: { ok: false, reason: 'not_due' }, error: null })
    }
    await completeLeague(client, LEAGUE_ID, { trigger: 'cron' })
    assertEquals(request, { name: 'complete_league_season', args: { p_league_id: LEAGUE_ID, p_trigger: 'cron' } })
  })
})
