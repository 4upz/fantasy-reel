/**
 * Unit tests for completeLeague (_shared/league-completion.ts).
 *
 * Runs against the in-memory mock client, so the ordering rules -- rank before
 * the state change, state change before any announcement, exactly one
 * announcement per season -- are checked without a database.
 */

import { assertEquals, assertStringIncludes } from '@std/assert'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'
import { completeLeague, type StandingRow } from './league-completion.ts'

const LEAGUE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const SERIES_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const PREV_LEAGUE_ID = 'cccccccc-3333-4333-8333-cccccccccccc'

const USER_A = 'd0000000-0000-4000-8000-00000000000a'
const USER_B = 'd0000000-0000-4000-8000-00000000000b'
const PARTICIPANT_A = 'e0000000-0000-4000-8000-00000000000a'
const PARTICIPANT_B = 'e0000000-0000-4000-8000-00000000000b'
const TEAM_A = 'f0000000-0000-4000-8000-00000000000a'
const TEAM_B = 'f0000000-0000-4000-8000-00000000000b'

/** The previous season's team for USER_A -- a different row, same person. */
const PREV_PARTICIPANT_A = 'e0000000-0000-4000-8000-0000000000fa'
const PREV_TEAM_A = 'f0000000-0000-4000-8000-0000000000fa'

function standing(
  overrides: Partial<StandingRow> & Pick<StandingRow, 'team_id' | 'team_name' | 'rank'>
): StandingRow {
  return {
    participant_id: overrides.team_id === TEAM_A ? PARTICIPANT_A : PARTICIPANT_B,
    user_id: overrides.team_id === TEAM_A ? USER_A : USER_B,
    total_points: 0,
    is_tied: false,
    ...overrides,
  }
}

function seedDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    leagues: [
      {
        id: LEAGUE_ID,
        name: 'Reel Heads',
        status: 'active',
        series_id: SERIES_ID,
        season_year: 2026,
        season_end: '2026-12-31',
        completed_at: null,
        winner_team_ids: null,
      },
    ],
    league_participants: [
      { id: PARTICIPANT_A, league_id: LEAGUE_ID, user_id: USER_A, status: 'active' },
      { id: PARTICIPANT_B, league_id: LEAGUE_ID, user_id: USER_B, status: 'active' },
    ],
    teams: [
      { id: TEAM_A, participant_id: PARTICIPANT_A, name: 'Alpha Pictures' },
      { id: TEAM_B, participant_id: PARTICIPANT_B, name: 'Beta Films' },
    ],
    profiles: [
      { user_id: USER_A, display_name: 'Ada' },
      { user_id: USER_B, display_name: 'Bo' },
    ],
    pickup_bids: [],
    counterpick_bids: [],
    trade_offers: [],
    discord_channels: [
      {
        id: 'channel-1',
        league_id: LEAGUE_ID,
        enabled: true,
        webhook_url: 'https://discord.com/api/webhooks/test',
        thread_id: null,
        bid_alert_role_id: null,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        notify_weekly_digest: true,
        notify_movie_news: true,
        consecutive_failures: 0,
      },
    ],
    notifications: [],
    ...overrides,
  }
}

function mockClient(db: MockDb, standings: StandingRow[], extraRpc: Record<string, unknown> = {}) {
  return createMockDbClient(db, {
    rpc: {
      recalculate_team_score_with_counterpicks: null,
      log_notification_delivery: null,
      league_standings: standings,
      ...extraRpc,
    },
    users: {
      [USER_A]: { email: 'ada@example.test' },
      [USER_B]: { email: 'bo@example.test' },
    },
  })
}

/** Resend is never configured in unit tests -- sendEmail short-circuits to `skipped`. */
function withoutResend(): void {
  Deno.env.delete('RESEND_API_KEY')
}

Deno.test('completeLeague', async (t) => {
  withoutResend()

  await t.step('stamps the champion, freezes the season, and announces once', async () => {
    const db = seedDb()
    const client = mockClient(db, [
      standing({ team_id: TEAM_A, team_name: 'Alpha Pictures', rank: 1, total_points: 84 }),
      standing({ team_id: TEAM_B, team_name: 'Beta Films', rank: 2, total_points: 12 }),
    ])
    const fetchStub = stubFetch()

    try {
      const result = await completeLeague(client, LEAGUE_ID, { trigger: 'owner' })

      assertEquals(result.ok, true)
      if (!result.ok) return

      assertEquals(result.winnerTeamIds, [TEAM_A])
      assertEquals(result.standings.length, 2)

      const league = db.leagues[0]
      assertEquals(league.status, 'completed')
      assertEquals(league.winner_team_ids, [TEAM_A])
      assertEquals(typeof league.completed_at, 'string')

      // The snapshot is what history reads, so it has to carry the names --
      // recomputing later would lose anyone who leaves the league.
      assertEquals(league.final_standings.length, 2)
      assertEquals(league.final_standings[0], {
        team_id: TEAM_A,
        team_name: 'Alpha Pictures',
        participant_id: PARTICIPANT_A,
        user_id: USER_A,
        total_points: 84,
        rank: 1,
        is_tied: false,
        display_name: 'Ada',
      })
      assertEquals(league.final_standings[1].display_name, 'Bo')

      // One embed, to the one enabled channel.
      assertEquals(fetchStub.calls.length, 1)
      const embed = (fetchStub.calls[0].body as { embeds: Array<Record<string, unknown>> }).embeds[0]
      assertEquals(embed.title, '🏆 Season Final Standings')
      const fields = embed.fields as Array<{ name: string; value: string }>
      assertEquals(fields[0].name, '🥇 Alpha Pictures')
      assertEquals(fields[0].value, '84.0 pts')

      // Every active participant hears about it in-app.
      assertEquals(db.notifications.length, 2)
      assertEquals(db.notifications.every((n) => n.type === 'season_completed'), true)
      assertEquals(
        new Set(db.notifications.map((n) => n.user_id)),
        new Set([USER_A, USER_B])
      )
      assertEquals(db.notifications[0].data, {
        league_id: LEAGUE_ID,
        series_id: SERIES_ID,
        season_year: 2026,
        winner_team_ids: [TEAM_A],
      })
      assertStringIncludes(db.notifications[0].body as string, 'Alpha Pictures takes the title')
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('every team tied at the top shares the title', async () => {
    const db = seedDb()
    const client = mockClient(db, [
      standing({ team_id: TEAM_A, team_name: 'Alpha Pictures', rank: 1, total_points: 50, is_tied: true }),
      standing({ team_id: TEAM_B, team_name: 'Beta Films', rank: 1, total_points: 50, is_tied: true }),
    ])
    const fetchStub = stubFetch()

    try {
      const result = await completeLeague(client, LEAGUE_ID, { trigger: 'cron' })

      assertEquals(result.ok, true)
      if (!result.ok) return

      assertEquals(result.winnerTeamIds, [TEAM_A, TEAM_B])
      assertEquals(db.leagues[0].winner_team_ids, [TEAM_A, TEAM_B])
      assertStringIncludes(
        db.notifications[0].body as string,
        'Alpha Pictures and Beta Films share the title'
      )
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('crowns the manager who won the previous season', async () => {
    const db = seedDb()
    // Last year's season of the same series, won by USER_A under a different
    // team row. The crown has to follow the person, not the team id.
    db.leagues.push({
      id: PREV_LEAGUE_ID,
      name: 'Reel Heads',
      status: 'completed',
      series_id: SERIES_ID,
      season_year: 2025,
      winner_team_ids: [PREV_TEAM_A],
    })
    db.teams.push({ id: PREV_TEAM_A, participant_id: PREV_PARTICIPANT_A, name: 'Alpha Pictures' })
    db.league_participants.push({
      id: PREV_PARTICIPANT_A,
      league_id: PREV_LEAGUE_ID,
      user_id: USER_A,
      status: 'active',
    })

    const client = mockClient(db, [
      standing({ team_id: TEAM_B, team_name: 'Beta Films', rank: 1, total_points: 90 }),
      standing({ team_id: TEAM_A, team_name: 'Alpha Pictures', rank: 2, total_points: 30 }),
    ])
    const fetchStub = stubFetch()

    try {
      await completeLeague(client, LEAGUE_ID, { trigger: 'cron' })

      const embed = (fetchStub.calls[0].body as { embeds: Array<Record<string, unknown>> }).embeds[0]
      const fields = embed.fields as Array<{ name: string }>
      assertEquals(fields[0].name, '🥇 Beta Films')
      assertEquals(fields[1].name, '🥈 Alpha Pictures 👑')
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('freezes everything that could still move a roster', async () => {
    const db = seedDb({
      pickup_bids: [
        { id: 'bid-active', league_id: LEAGUE_ID, team_id: TEAM_A, status: 'active' },
        { id: 'bid-outbid', league_id: LEAGUE_ID, team_id: TEAM_B, status: 'outbid' },
        // Already resolved, and in another league -- neither may be touched.
        { id: 'bid-won', league_id: LEAGUE_ID, team_id: TEAM_A, status: 'won' },
        { id: 'bid-other-league', league_id: 'other', team_id: 'x', status: 'active' },
      ],
      counterpick_bids: [
        { id: 'cp-active', league_id: LEAGUE_ID, team_id: TEAM_B, status: 'active' },
      ],
      trade_offers: [
        { id: 'trade-proposed', league_id: LEAGUE_ID, status: 'proposed', expired_reason: null },
        // The dangerous one: process-trades would execute this tomorrow.
        { id: 'trade-accepted', league_id: LEAGUE_ID, status: 'accepted', expired_reason: null },
        { id: 'trade-done', league_id: LEAGUE_ID, status: 'completed', expired_reason: null },
        { id: 'trade-other-league', league_id: 'other', status: 'proposed', expired_reason: null },
      ],
    })
    const client = mockClient(db, [
      standing({ team_id: TEAM_A, team_name: 'Alpha Pictures', rank: 1, total_points: 84 }),
    ])
    const fetchStub = stubFetch()

    try {
      const result = await completeLeague(client, LEAGUE_ID, { trigger: 'cron' })

      assertEquals(result.ok, true)
      if (!result.ok) return

      assertEquals(result.voidedBids, 3)
      assertEquals(result.expiredTrades, 2)

      const bidStatus = (id: string) => db.pickup_bids.find((b) => b.id === id)?.status
      // 'cancelled', not 'lost': nobody was outbid, and nothing is charged.
      assertEquals(bidStatus('bid-active'), 'cancelled')
      assertEquals(bidStatus('bid-outbid'), 'cancelled')
      assertEquals(bidStatus('bid-won'), 'won')
      assertEquals(bidStatus('bid-other-league'), 'active')
      assertEquals(db.counterpick_bids[0].status, 'cancelled')

      const trade = (id: string) => db.trade_offers.find((o) => o.id === id)
      assertEquals(trade('trade-proposed')?.status, 'expired')
      assertEquals(trade('trade-accepted')?.status, 'expired')
      assertEquals(trade('trade-accepted')?.expired_reason, 'season_completed')
      assertEquals(trade('trade-done')?.status, 'completed')
      assertEquals(trade('trade-other-league')?.status, 'proposed')
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('a season that is not active is refused', async () => {
    const db = seedDb()
    db.leagues[0].status = 'drafting'
    const client = mockClient(db, [])
    const fetchStub = stubFetch()

    try {
      const result = await completeLeague(client, LEAGUE_ID, { trigger: 'owner' })

      assertEquals(result, { ok: false, reason: 'not_active' })
      assertEquals(fetchStub.calls.length, 0)
      assertEquals(db.notifications.length, 0)
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('an unknown league is refused', async () => {
    const client = mockClient(seedDb(), [])
    const result = await completeLeague(client, 'ffffffff-9999-4999-8999-ffffffffffff', {
      trigger: 'cron',
    })
    assertEquals(result, { ok: false, reason: 'not_found' })
  })

  await t.step('loses the race rather than announcing a second champion', async () => {
    const db = seedDb()
    const standings = [
      standing({ team_id: TEAM_A, team_name: 'Alpha Pictures', rank: 1, total_points: 84 }),
    ]

    // Simulate the commissioner completing the season in the window between
    // our read and our update: the check-and-set must match no rows.
    const client = createMockDbClient(db, {
      rpc: {
        recalculate_team_score_with_counterpicks: null,
        log_notification_delivery: null,
        league_standings: () => {
          db.leagues[0].status = 'completed'
          return standings
        },
      },
    })
    const fetchStub = stubFetch()

    try {
      const result = await completeLeague(client, LEAGUE_ID, { trigger: 'cron' })

      assertEquals(result, { ok: false, reason: 'not_active' })
      // The season keeps whatever the winner already set; nothing is announced.
      assertEquals(db.leagues[0].winner_team_ids, null)
      assertEquals(fetchStub.calls.length, 0)
      assertEquals(db.notifications.length, 0)
    } finally {
      fetchStub.restore()
    }
  })
})
