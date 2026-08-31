/**
 * Unit tests for the complete-seasons cron handler
 * (../complete-seasons/handler.ts).
 *
 * The two behaviours worth pinning down without a database: only overdue
 * seasons are closed, and the 7-day reminder fires exactly once no matter how
 * often the cron runs.
 */

import { assertEquals, assertStringIncludes } from '@std/assert'
import { createMockDbClient, stubFetch, type MockDb, type Row } from './_mock-client.ts'
import { runCompleteSeasons } from '../complete-seasons/handler.ts'

const OVERDUE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const FUTURE_ID = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'
const ENDING_SOON_ID = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'
const SERIES_ID = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'

const USER_A = 'd0000000-0000-4000-8000-00000000000a'
const PARTICIPANT_A = 'e0000000-0000-4000-8000-00000000000a'
const TEAM_A = 'f0000000-0000-4000-8000-00000000000a'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dateOnly(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10)
}

function league(id: string, seasonEnd: string, overrides: Row = {}): Row {
  return {
    id,
    name: `League ${id.slice(0, 4)}`,
    status: 'active',
    series_id: SERIES_ID,
    season_year: 2026,
    season_end: seasonEnd,
    completed_at: null,
    winner_team_ids: null,
    ...overrides,
  }
}

function channel(leagueId: string): Row {
  return {
    id: `channel-${leagueId.slice(0, 4)}`,
    league_id: leagueId,
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
  }
}

function clientFor(db: MockDb, standingsByLeague: Record<string, Row[]> = {}) {
  return createMockDbClient(db, {
    rpc: {
      recalculate_team_score_with_counterpicks: null,
      log_notification_delivery: null,
      league_standings: (args?: Row) => standingsByLeague[args?.p_league_id as string] ?? [],
    },
    // Reproduces uq_discord_notification_log_no_movie: a second claim for the
    // same (league, type) with no movie collides.
    unique: { discord_notification_log: ['league_id', 'movie_id', 'notification_type'] },
  })
}

Deno.test('runCompleteSeasons', async (t) => {
  Deno.env.delete('RESEND_API_KEY')

  await t.step('closes seasons past their end date and leaves the rest alone', async () => {
    const db: MockDb = {
      leagues: [league(OVERDUE_ID, dateOnly(-1)), league(FUTURE_ID, dateOnly(30))],
      league_participants: [
        { id: PARTICIPANT_A, league_id: OVERDUE_ID, user_id: USER_A, status: 'active' },
      ],
      teams: [{ id: TEAM_A, participant_id: PARTICIPANT_A, name: 'Alpha Pictures' }],
      profiles: [{ user_id: USER_A, display_name: 'Ada' }],
      discord_channels: [channel(OVERDUE_ID)],
      notifications: [],
      discord_notification_log: [],
    }
    const client = clientFor(db, {
      [OVERDUE_ID]: [
        {
          team_id: TEAM_A,
          team_name: 'Alpha Pictures',
          participant_id: PARTICIPANT_A,
          user_id: USER_A,
          total_points: 42,
          rank: 1,
          is_tied: false,
        },
      ],
    })
    const fetchStub = stubFetch()

    try {
      const result = await runCompleteSeasons(client)

      assertEquals(result.seasons_completed, 1)
      assertEquals(result.seasons_failed, 0)
      assertEquals(result.seasons_skipped, 0)

      assertEquals(db.leagues.find((l) => l.id === OVERDUE_ID)?.status, 'completed')
      assertEquals(db.leagues.find((l) => l.id === OVERDUE_ID)?.winner_team_ids, [TEAM_A])
      // The season with a month left is untouched.
      assertEquals(db.leagues.find((l) => l.id === FUTURE_ID)?.status, 'active')
      assertEquals(db.leagues.find((l) => l.id === FUTURE_ID)?.completed_at, null)
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('warns a season ending in seven days, exactly once', async () => {
    const db: MockDb = {
      leagues: [league(ENDING_SOON_ID, dateOnly(7))],
      league_participants: [],
      teams: [],
      profiles: [],
      discord_channels: [channel(ENDING_SOON_ID)],
      notifications: [],
      discord_notification_log: [],
    }
    const client = clientFor(db)
    const fetchStub = stubFetch()

    try {
      const first = await runCompleteSeasons(client)
      assertEquals(first.reminders_sent, 1)
      assertEquals(first.seasons_completed, 0)
      assertEquals(db.discord_notification_log.length, 1)
      assertEquals(db.discord_notification_log[0].movie_id, null)
      // The date is part of the key -- see the next step for why.
      assertEquals(
        db.discord_notification_log[0].notification_type,
        `season_end_reminder:${dateOnly(7)}`
      )

      const embed = (fetchStub.calls[0].body as { embeds: Array<Record<string, unknown>> }).embeds[0]
      assertEquals(embed.title, '⏳ Season ends in 7 days')
      assertStringIncludes(embed.description as string, dateOnly(7))

      // Same day, second run: the claim collides and nothing is re-posted.
      const second = await runCompleteSeasons(client)
      assertEquals(second.reminders_sent, 0)
      assertEquals(fetchStub.calls.length, 1)
      assertEquals(db.discord_notification_log.length, 1)
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('a season end that has moved since the last warning earns a fresh one', async () => {
    // The league was already warned, back when it was going to end earlier.
    // The commissioner has since extended it, and today is seven days out from
    // the NEW date. A bare `season_end_reminder` key would treat the old
    // warning as covering this one and the league would sail past its real end
    // date having been told about a date that no longer exists.
    const db: MockDb = {
      leagues: [league(ENDING_SOON_ID, dateOnly(7))],
      league_participants: [],
      teams: [],
      profiles: [],
      discord_channels: [channel(ENDING_SOON_ID)],
      notifications: [],
      discord_notification_log: [
        {
          league_id: ENDING_SOON_ID,
          movie_id: null,
          notification_type: `season_end_reminder:${dateOnly(-30)}`,
        },
      ],
    }
    const client = clientFor(db)
    const fetchStub = stubFetch()

    try {
      const result = await runCompleteSeasons(client)

      assertEquals(result.reminders_sent, 1)
      assertEquals(db.discord_notification_log.length, 2)
      assertEquals(
        db.discord_notification_log[1].notification_type,
        `season_end_reminder:${dateOnly(7)}`
      )
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('a warning already sent for this exact end date is not repeated', async () => {
    const db: MockDb = {
      leagues: [league(ENDING_SOON_ID, dateOnly(7))],
      league_participants: [],
      teams: [],
      profiles: [],
      discord_channels: [channel(ENDING_SOON_ID)],
      notifications: [],
      discord_notification_log: [
        {
          league_id: ENDING_SOON_ID,
          movie_id: null,
          notification_type: `season_end_reminder:${dateOnly(7)}`,
        },
      ],
    }
    const client = clientFor(db)
    const fetchStub = stubFetch()

    try {
      const result = await runCompleteSeasons(client)

      assertEquals(result.reminders_sent, 0)
      assertEquals(fetchStub.calls.length, 0)
      assertEquals(db.discord_notification_log.length, 1)
    } finally {
      fetchStub.restore()
    }
  })

  await t.step('one failing season does not strand the others', async () => {
    const db: MockDb = {
      leagues: [league(OVERDUE_ID, dateOnly(-3)), league(FUTURE_ID, dateOnly(-2))],
      league_participants: [
        { id: PARTICIPANT_A, league_id: FUTURE_ID, user_id: USER_A, status: 'active' },
      ],
      teams: [{ id: TEAM_A, participant_id: PARTICIPANT_A, name: 'Alpha Pictures' }],
      profiles: [{ user_id: USER_A, display_name: 'Ada' }],
      discord_channels: [],
      notifications: [],
      discord_notification_log: [],
    }

    // The first league's standings blow up; the second must still be closed.
    const client = createMockDbClient(db, {
      rpc: {
        recalculate_team_score_with_counterpicks: null,
        log_notification_delivery: null,
        league_standings: (args?: Row) => {
          if (args?.p_league_id === OVERDUE_ID) throw new Error('standings exploded')
          return [
            {
              team_id: TEAM_A,
              team_name: 'Alpha Pictures',
              participant_id: PARTICIPANT_A,
              user_id: USER_A,
              total_points: 7,
              rank: 1,
              is_tied: false,
            },
          ]
        },
      },
    })
    const fetchStub = stubFetch()

    try {
      const result = await runCompleteSeasons(client)

      assertEquals(result.seasons_failed, 1)
      assertEquals(result.seasons_completed, 1)
      assertEquals(result.errors.length, 1)
      assertEquals(db.leagues.find((l) => l.id === OVERDUE_ID)?.status, 'active')
      assertEquals(db.leagues.find((l) => l.id === FUTURE_ID)?.status, 'completed')
    } finally {
      fetchStub.restore()
    }
  })
})
