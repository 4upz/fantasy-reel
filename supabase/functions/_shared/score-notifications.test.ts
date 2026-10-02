/**
 * Unit tests for score notification building and dispatch.
 *
 * Run with: deno task test:unit
 */

import { assertEquals, assertExists, assertStringIncludes } from '@std/assert'
import {
  captureScoreContext,
  formatPoints,
  formatMovieScore,
  formatRtScore,
  ordinal,
  rankStandings,
  diffStandings,
  buildMovieScoreEmbed,
  buildStandingsEmbed,
  crossesNotableMissThreshold,
  sendScoreNotifications,
  shouldAnnounceScore,
  type MoviePlacement,
  type ScoreNotificationContext,
  type StandingChange,
  type TeamStanding,
} from './score-notifications.ts'
import { DISCORD_COLORS } from './discord.ts'
import { createMockDbClient, type MockDb } from './_mock-client.ts'

// ============================================================================
// Formatting
// ============================================================================

Deno.test('formatPoints - renders one decimal place', () => {
  assertEquals(formatPoints(80.34), '80.3')
  assertEquals(formatPoints(45), '45.0')
  assertEquals(formatPoints(-12.567), '-12.6')
})

Deno.test('formatRtScore - renders the Tomatometer as a whole percentage', () => {
  assertEquals(formatRtScore(93), '93% RT')
  assertEquals(formatRtScore(72.4), '72% RT')
  assertEquals(formatRtScore(72.6), '73% RT')
})

Deno.test('formatMovieScore - leads with RT and puts points in parentheses', () => {
  assertEquals(formatMovieScore(93, 36), '**93% RT** (36.0 pts)')
  assertEquals(formatMovieScore(35, -16.25), '**35% RT** (-16.3 pts)')
})

Deno.test('formatMovieScore - falls back to points alone without an RT score', () => {
  assertEquals(formatMovieScore(null, 12), '**12.0** pts')
})

Deno.test('ordinal - handles suffixes including the teens', () => {
  assertEquals(ordinal(1), '1st')
  assertEquals(ordinal(2), '2nd')
  assertEquals(ordinal(3), '3rd')
  assertEquals(ordinal(4), '4th')
  assertEquals(ordinal(11), '11th')
  assertEquals(ordinal(12), '12th')
  assertEquals(ordinal(13), '13th')
  assertEquals(ordinal(21), '21st')
  assertEquals(ordinal(102), '102nd')
})

// ============================================================================
// Ranking
// ============================================================================

Deno.test('rankStandings - orders by points descending', () => {
  const ranked = rankStandings([
    { teamId: 'a', teamName: 'Alpha', points: 23.7 },
    { teamId: 'b', teamName: 'Bravo', points: 58.6 },
    { teamId: 'c', teamName: 'Charlie', points: 45.7 },
  ])

  assertEquals(ranked.map((t) => t.teamId), ['b', 'c', 'a'])
  assertEquals(ranked.map((t) => t.rank), [1, 2, 3])
})

Deno.test('rankStandings - ties share a rank and skip the next (1,2,2,4)', () => {
  const ranked = rankStandings([
    { teamId: 'a', teamName: 'Alpha', points: 50 },
    { teamId: 'b', teamName: 'Bravo', points: 40 },
    { teamId: 'c', teamName: 'Charlie', points: 40 },
    { teamId: 'd', teamName: 'Delta', points: 10 },
  ])

  assertEquals(ranked.map((t) => t.rank), [1, 2, 2, 4])
})

Deno.test('rankStandings - ranks a zero above a negative score', () => {
  const ranked = rankStandings([
    { teamId: 'a', teamName: 'Alpha', points: 0 },
    { teamId: 'b', teamName: 'Bravo', points: -5 },
  ])

  assertEquals(ranked.map((t) => t.teamId), ['a', 'b'])
})

Deno.test('rankStandings - tie order is stable across snapshots', () => {
  // Guards against a phantom "moved from 2nd to 1st" when two teams are level:
  // tied teams must receive the same rank, whatever order they arrive in.
  const teams = [
    { teamId: 'a', teamName: 'Alpha', points: 40 },
    { teamId: 'b', teamName: 'Bravo', points: 40 },
  ]

  const forward = rankStandings(teams)
  const reversed = rankStandings([...teams].reverse())

  const rankOf = (r: TeamStanding[], id: string) => r.find((t) => t.teamId === id)!.rank
  assertEquals(rankOf(forward, 'a'), rankOf(reversed, 'a'))
  assertEquals(rankOf(forward, 'b'), rankOf(reversed, 'b'))
  assertEquals(diffStandings(forward, reversed).length, 0)
})

// ============================================================================
// Diffing
// ============================================================================

function standing(
  teamId: string,
  teamName: string,
  points: number,
  rank: number
): TeamStanding {
  return { teamId, teamName, points, rank }
}

Deno.test('diffStandings - reports score and rank movement together', () => {
  const before = [standing('a', 'Alpha', 57.2, 1), standing('b', 'Bravo', 45.7, 2)]
  const after = [standing('b', 'Bravo', 58.6, 1), standing('a', 'Alpha', 45.7, 2)]

  const changes = diffStandings(before, after)

  assertEquals(changes.length, 2)
  // Sorted by new rank, so Bravo (now 1st) comes first
  assertEquals(changes[0].teamName, 'Bravo')
  assertEquals(changes[0].previousPoints, 45.7)
  assertEquals(changes[0].newPoints, 58.6)
  assertEquals(changes[0].previousRank, 2)
  assertEquals(changes[0].newRank, 1)
  assertEquals(changes[0].pointsChanged, true)
  assertEquals(changes[0].rankChanged, true)
})

Deno.test('diffStandings - reports rank movement with no score change', () => {
  const before = [standing('a', 'Alpha', 30, 1), standing('b', 'Bravo', 20, 2)]
  const after = [standing('b', 'Bravo', 40, 1), standing('a', 'Alpha', 30, 2)]

  const changes = diffStandings(before, after)
  const alpha = changes.find((c) => c.teamId === 'a')

  assertExists(alpha)
  assertEquals(alpha.pointsChanged, false)
  assertEquals(alpha.rankChanged, true)
  assertEquals(alpha.previousRank, 1)
  assertEquals(alpha.newRank, 2)
})

Deno.test('diffStandings - ignores changes too small to display', () => {
  const before = [standing('a', 'Alpha', 45.70, 1)]
  const after = [standing('a', 'Alpha', 45.74, 1)]

  assertEquals(diffStandings(before, after).length, 0)
})

Deno.test('diffStandings - returns nothing when nothing moved', () => {
  const before = [standing('a', 'Alpha', 30, 1), standing('b', 'Bravo', 20, 2)]
  assertEquals(diffStandings(before, before).length, 0)
})

Deno.test('diffStandings - skips teams absent from the earlier snapshot', () => {
  const before = [standing('a', 'Alpha', 30, 1)]
  const after = [standing('a', 'Alpha', 30, 1), standing('new', 'Newcomer', 10, 2)]

  assertEquals(diffStandings(before, after).length, 0)
})

Deno.test('diffStandings - skips a total that moved less than 3 without changing rank', () => {
  const before = [standing('a', 'Alpha', 45.7, 1), standing('b', 'Bravo', 30.0, 2)]
  const after = [standing('a', 'Alpha', 47.7, 1), standing('b', 'Bravo', 30.0, 2)]

  assertEquals(diffStandings(before, after).length, 0)
})

Deno.test('diffStandings - reports a total that moved exactly 3', () => {
  const before = [standing('a', 'Alpha', 45.7, 1)]
  const after = [standing('a', 'Alpha', 48.7, 1)]

  const changes = diffStandings(before, after)

  assertEquals(changes.length, 1)
  assertEquals(changes[0].pointsChanged, true)
  assertEquals(changes[0].rankChanged, false)
})

Deno.test('diffStandings - a rank change brings its small score move along', () => {
  // One point is under the bar on its own, but it is what put Alpha ahead
  const before = [standing('b', 'Bravo', 30.5, 1), standing('a', 'Alpha', 30.0, 2)]
  const after = [standing('a', 'Alpha', 31.0, 1), standing('b', 'Bravo', 30.5, 2)]

  const changes = diffStandings(before, after)

  assertEquals(changes.length, 2)
  assertEquals(changes[0].teamName, 'Alpha')
  assertEquals(changes[0].pointsChanged, true)
  assertEquals(changes[0].rankChanged, true)
  assertEquals(changes[1].teamName, 'Bravo')
  assertEquals(changes[1].pointsChanged, false)
  assertEquals(changes[1].rankChanged, true)
})

// ============================================================================
// Announcement threshold
// ============================================================================

function scores(points: number | null, rtScore: number | null) {
  return { points, rtScore }
}

Deno.test('shouldAnnounceScore - a movie never announced always qualifies', () => {
  assertEquals(shouldAnnounceScore(scores(null, null), scores(0, 60)), true)
})

Deno.test('shouldAnnounceScore - holds back moves under 3 points', () => {
  assertEquals(shouldAnnounceScore(scores(20, 80), scores(21, 81)), false)
  assertEquals(shouldAnnounceScore(scores(20, 80), scores(18, 78)), false)
})

Deno.test('shouldAnnounceScore - a move of exactly 3 qualifies, either direction', () => {
  assertEquals(shouldAnnounceScore(scores(20, 80), scores(23, 83)), true)
  assertEquals(shouldAnnounceScore(scores(20, 80), scores(17, 77)), true)
  // Decimal subtraction lands a hair under 3 here
  assertEquals(shouldAnnounceScore(scores(1.1, 61), scores(4.1, 64)), true)
})

Deno.test('shouldAnnounceScore - points alone qualify above 90%, where RT counts double', () => {
  assertEquals(shouldAnnounceScore(scores(34, 92), scores(38, 94)), true)
})

Deno.test('shouldAnnounceScore - RT alone qualifies in the flat tail, where points barely move', () => {
  assertEquals(shouldAnnounceScore(scores(-19.53, 5), scores(-19.44, 8)), true)
})

Deno.test('shouldAnnounceScore - a withdrawn score is never announced', () => {
  assertEquals(shouldAnnounceScore(scores(20, 80), scores(null, null)), false)
})

// ============================================================================
// Movie embeds
// ============================================================================

const placement: MoviePlacement = {
  movieId: 'movie-1',
  leagueId: 'league-1',
  ownerTeamName: "Aceassin's Creed (Ace)",
  counterpickerTeamName: null,
}

Deno.test('buildMovieScoreEmbed - first score reads "Now has a score of"', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Splatoon Raiders',
      posterUrl: '/poster.jpg',
      previousPoints: null,
      newPoints: 36.0,
      previousRtScore: null,
      newRtScore: 93,
      isNewScore: true,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(embed.title, 'Splatoon Raiders')
  assertEquals(embed.description, 'Now has a score of **93% RT** (36.0 pts)')
  assertEquals(embed.color, DISCORD_COLORS.blue)
  assertEquals(embed.thumbnail?.url, 'https://image.tmdb.org/t/p/w92/poster.jpg')
  assertEquals(embed.fields?.[0], {
    name: 'Picked by',
    value: "Aceassin's Creed (Ace)",
    inline: true,
  })
})

Deno.test('buildMovieScoreEmbed - rising score is green and reads UP', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Splatoon Raiders',
      posterUrl: null,
      previousPoints: 12.0,
      newPoints: 18.0,
      previousRtScore: 72,
      newRtScore: 78,
      isNewScore: false,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(
    embed.description,
    'Score has gone **UP** from **72% RT** (12.0 pts) to **78% RT** (18.0 pts)'
  )
  assertEquals(embed.color, DISCORD_COLORS.green)
  assertEquals(embed.thumbnail, undefined)
})

Deno.test('buildMovieScoreEmbed - falling score is crimson and reads DOWN', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Splatoon Raiders',
      posterUrl: null,
      previousPoints: 8.0,
      newPoints: -5.0,
      previousRtScore: 68,
      newRtScore: 55,
      isNewScore: false,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(
    embed.description,
    'Score has gone **DOWN** from **68% RT** (8.0 pts) to **55% RT** (-5.0 pts)'
  )
  assertEquals(embed.color, DISCORD_COLORS.crimson)
})

Deno.test('buildMovieScoreEmbed - falls back to points alone when RT is missing', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Splatoon Raiders',
      posterUrl: null,
      previousPoints: null,
      newPoints: 36.0,
      previousRtScore: null,
      newRtScore: null,
      isNewScore: true,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(embed.description, 'Now has a score of **36.0** pts')
})

Deno.test('buildMovieScoreEmbed - includes counterpicker when present', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Avatar Legends',
      posterUrl: null,
      previousPoints: null,
      newPoints: 12.0,
      previousRtScore: null,
      newRtScore: 72,
      isNewScore: true,
    },
    { ...placement, counterpickerTeamName: 'Polo King' },
    'MoC Fantasy League'
  )

  assertEquals(embed.fields?.length, 2)
  assertEquals(embed.fields?.[1], {
    name: 'Counterpicked by',
    value: 'Polo King',
    inline: true,
  })
})

// ============================================================================
// Standings embed
// ============================================================================

function change(overrides: Partial<StandingChange>): StandingChange {
  return {
    teamId: 'a',
    teamName: 'Alpha',
    previousPoints: 45.7,
    newPoints: 58.6,
    previousRank: 2,
    newRank: 1,
    pointsChanged: true,
    rankChanged: true,
    ...overrides,
  }
}

Deno.test('buildStandingsEmbed - renders score and rank lines per team', () => {
  const embed = buildStandingsEmbed(
    [change({ teamName: "Aceassin's Creed (Ace)" })],
    'MoC Fantasy League',
    'league-1'
  )

  assertEquals(embed.title, 'Standings Update')
  assertEquals(embed.fields?.length, 1)
  assertEquals(embed.fields?.[0].name, "Aceassin's Creed (Ace)")
  assertEquals(
    embed.fields?.[0].value,
    'Score has gone **UP** from **45.7** to **58.6**\nMoved from **2nd** place to **1st** place'
  )
})

Deno.test('buildStandingsEmbed - rank-only change omits the score line', () => {
  const embed = buildStandingsEmbed(
    [
      change({
        teamName: 'Freaksona Royale',
        pointsChanged: false,
        previousRank: 6,
        newRank: 7,
      }),
    ],
    'MoC Fantasy League',
    'league-1'
  )

  assertEquals(embed.fields?.[0].value, 'Moved from **6th** place to **7th** place')
})

Deno.test('buildStandingsEmbed - score-only change omits the rank line', () => {
  const embed = buildStandingsEmbed(
    [change({ rankChanged: false, previousRank: 3, newRank: 3 })],
    'MoC Fantasy League',
    'league-1'
  )

  assertEquals(embed.fields?.[0].value, 'Score has gone **UP** from **45.7** to **58.6**')
})

Deno.test('buildStandingsEmbed - summarizes movers in the description', () => {
  const embed = buildStandingsEmbed(
    [
      change({ teamId: 'a', teamName: 'Alpha' }),
      change({ teamId: 'b', teamName: 'Bravo', rankChanged: false }),
    ],
    'MoC Fantasy League',
    'league-1'
  )

  assertEquals(embed.description, '2 teams updated, 1 changed position')
})

Deno.test('buildStandingsEmbed - caps at Discord 25-field limit and notes the rest', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    change({ teamId: `t${i}`, teamName: `Team ${i}` })
  )

  const embed = buildStandingsEmbed(many, 'Big League', 'league-1')

  assertEquals(embed.fields?.length, 25)
  assertStringIncludes(embed.footer?.text ?? '', '5 more not shown')
})

// ============================================================================
// Mock infrastructure
// ============================================================================

interface MockResult {
  data: unknown
  error: { message: string } | null
}

/**
 * Mock client where each table returns a queue of results -- successive reads
 * of the same table (before/after snapshots) pop the next entry, and the last
 * entry repeats once the queue drains.
 */
function createMockSupabase(tables: Record<string, MockResult[]>) {
  const reads: string[] = []

  function nextResult(table: string): MockResult {
    const queue = tables[table]
    if (!queue || queue.length === 0) return { data: [], error: null }
    return queue.length === 1 ? queue[0] : queue.shift()!
  }

  function chain(table: string) {
    const resolve = () => {
      reads.push(table)
      return Promise.resolve(nextResult(table))
    }

    // deno-lint-ignore no-explicit-any
    const c: any = {
      then: (ok: unknown, err: unknown) =>
        // deno-lint-ignore no-explicit-any
        resolve().then(ok as any, err as any),
      single: resolve,
    }
    for (const method of ['select', 'in', 'eq', 'is', 'not', 'order', 'limit', 'update']) {
      c[method] = () => c
    }
    return c
  }

  const client = { from: (table: string) => chain(table) }
  // deno-lint-ignore no-explicit-any
  return { client: client as any, reads }
}

const originalFetch = globalThis.fetch

function mockWebhookFetch() {
  const calls: Array<Record<string, unknown>> = []
  globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(init?.body as string))
    return Promise.resolve(new Response(null, { status: 204 }))
  }
  return calls
}

function enabledChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    webhook_url: 'https://discord.com/api/webhooks/1/abc',
    thread_id: null,
    bid_alert_role_id: null,
    notify_drafts: true,
    notify_bids: true,
    notify_trades: true,
    notify_scores: true,
    consecutive_failures: 0,
    ...overrides,
  }
}

/**
 * The last-posted score columns, matching baseContext's pre-run snapshot --
 * the steady state, where the previous run posted the movie's last move.
 */
const ANNOUNCED_AT_SNAPSHOT = { announced_fantasy_points: 20.0, announced_rt_score: 80 }

function baseContext(): ScoreNotificationContext {
  return {
    movieIds: ['movie-1'],
    leagueIds: ['league-1'],
    previousMovieScores: new Map([['movie-1', { points: 20.0, rtScore: 80 }]]),
    leagueNames: new Map([['league-1', 'MoC Fantasy League']]),
    previousStandings: new Map([
      [
        'league-1',
        [standing('team-a', 'Alpha', 45.7, 1), standing('team-b', 'Bravo', 30.0, 2)],
      ],
    ]),
    placements: [
      {
        movieId: 'movie-1',
        leagueId: 'league-1',
        ownerTeamName: 'Bravo',
        counterpickerTeamName: null,
      },
    ],
    droppedPlacements: [],
  }
}

// ============================================================================
// Holding resolution (draft_picks + pickups)
// ============================================================================

/** Minimal fixtures for the two league/standings lookups every capture makes. */
const CAPTURE_LEAGUE_TABLES = {
  counterpicks: [{ data: [], error: null }],
  leagues: [{ data: [{ id: 'league-1', name: 'MoC Fantasy League' }], error: null }],
  league_participants: [{ data: [{ id: 'p-a', league_id: 'league-1' }], error: null }],
  teams: [{ data: [{ id: 'team-a', name: 'Alpha', participant_id: 'p-a' }], error: null }],
  team_scores: [{ data: [{ team_id: 'team-a', total_points: 10 }], error: null }],
}

Deno.test('captureScoreContext - active pickup wins over a dropped draft pick', async () => {
  // A movie dropped from the draft becomes eligible for re-acquisition at
  // auction in the same league, so both rows coexist. Taking the dropped one
  // would suppress the movie embed for the team that actually holds it.
  const { client } = createMockSupabase({
    movies: [{ data: [{ id: 'movie-1', fantasy_points: null, combined_score: null }], error: null }],
    draft_picks: [{
      data: [{
        movie_id: 'movie-1',
        league_id: 'league-1',
        dropped_at: '2026-01-01T00:00:00Z',
        teams: { name: 'Former Owner' },
      }],
      error: null,
    }],
    pickups: [{
      data: [{
        movie_id: 'movie-1',
        league_id: 'league-1',
        dropped_at: null,
        teams: { name: 'Current Owner' },
      }],
      error: null,
    }],
    ...CAPTURE_LEAGUE_TABLES,
  })

  const context = await captureScoreContext(client, ['movie-1'])

  assertEquals(context.leagueIds, ['league-1'])
  assertEquals(context.placements.length, 1)
  assertEquals(context.placements[0].ownerTeamName, 'Current Owner')
})

Deno.test('captureScoreContext - dropped-only holding marks the league without a placement', async () => {
  // Dropped movies still count toward the old owner's total (the scoring RPC
  // applies no dropped_at filter), so the league must still be notified.
  const { client } = createMockSupabase({
    movies: [{ data: [{ id: 'movie-1', fantasy_points: 20, combined_score: 80 }], error: null }],
    draft_picks: [{
      data: [{
        movie_id: 'movie-1',
        league_id: 'league-1',
        dropped_at: '2026-01-01T00:00:00Z',
        teams: { name: 'Former Owner' },
      }],
      error: null,
    }],
    pickups: [{ data: [], error: null }],
    ...CAPTURE_LEAGUE_TABLES,
  })

  const context = await captureScoreContext(client, ['movie-1'])

  assertEquals(context.leagueIds, ['league-1'])
  assertEquals(context.placements.length, 0)
})

Deno.test('captureScoreContext - a movie held in two leagues yields one placement each', async () => {
  const { client } = createMockSupabase({
    movies: [{ data: [{ id: 'movie-1', fantasy_points: null, combined_score: null }], error: null }],
    draft_picks: [{
      data: [{ movie_id: 'movie-1', league_id: 'league-1', dropped_at: null, teams: { name: 'Alpha' } }],
      error: null,
    }],
    pickups: [{
      data: [{ movie_id: 'movie-1', league_id: 'league-2', dropped_at: null, teams: { name: 'Bravo' } }],
      error: null,
    }],
    ...CAPTURE_LEAGUE_TABLES,
  })

  const context = await captureScoreContext(client, ['movie-1'])

  assertEquals(context.leagueIds.sort(), ['league-1', 'league-2'])
  assertEquals(context.placements.length, 2)
})

// ============================================================================
// Dispatch
// ============================================================================

Deno.test('sendScoreNotifications - posts a movie embed and a standings embed', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 34.0, combined_score: 92, ...ANNOUNCED_AT_SNAPSHOT }], error: null },
      ],
      league_participants: [
        { data: [{ id: 'p-a', league_id: 'league-1' }, { id: 'p-b', league_id: 'league-1' }], error: null },
      ],
      teams: [
        { data: [{ id: 'team-a', name: 'Alpha', participant_id: 'p-a' }, { id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null },
      ],
      // Bravo's movie scored, vaulting it past Alpha
      team_scores: [
        { data: [{ team_id: 'team-a', total_points: 45.7 }, { team_id: 'team-b', total_points: 58.6 }], error: null },
      ],
      discord_channels: [
        {
          data: [{
            id: 'ch-1',
            webhook_url: 'https://discord.com/api/webhooks/1/abc',
            thread_id: null,
            bid_alert_role_id: null,
            notify_drafts: true,
            notify_bids: true,
            notify_trades: true,
            notify_scores: true,
            consecutive_failures: 0,
          }],
          error: null,
        },
      ],
    })

    const summary = await sendScoreNotifications(client, baseContext())

    assertEquals(summary.movie_updates, 1)
    assertEquals(summary.standings_updates, 1)
    assertEquals(summary.leagues_with_changes, 1)
    assertEquals(calls.length, 2)

    // First message: the movie score change
    const movieEmbed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(movieEmbed.title, 'Splatoon Raiders')
    assertEquals(
      movieEmbed.description,
      'Score has gone **UP** from **80% RT** (20.0 pts) to **92% RT** (34.0 pts)'
    )

    // Second message: the standings roundup, both teams moved
    const standingsEmbed = (calls[1].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(standingsEmbed.title, 'Standings Update')
    const fields = standingsEmbed.fields as Array<{ name: string; value: string }>
    assertEquals(fields.length, 2)
    assertEquals(fields[0].name, 'Bravo')
    assertStringIncludes(fields[0].value, 'Moved from **2nd** place to **1st** place')
    assertEquals(fields[1].name, 'Alpha')
    assertStringIncludes(fields[1].value, 'Moved from **1st** place to **2nd** place')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - sends nothing when no score moved', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      // Same score as the snapshot
      movies: [
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 20.0, combined_score: 80, ...ANNOUNCED_AT_SNAPSHOT }], error: null },
      ],
      league_participants: [
        { data: [{ id: 'p-a', league_id: 'league-1' }, { id: 'p-b', league_id: 'league-1' }], error: null },
      ],
      teams: [
        { data: [{ id: 'team-a', name: 'Alpha', participant_id: 'p-a' }, { id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null },
      ],
      team_scores: [
        { data: [{ team_id: 'team-a', total_points: 45.7 }, { team_id: 'team-b', total_points: 30.0 }], error: null },
      ],
    })

    const summary = await sendScoreNotifications(client, baseContext())

    assertEquals(summary.movie_updates, 0)
    assertEquals(summary.standings_updates, 0)
    assertEquals(calls.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - posts when the Tomatometer moves but points round the same', async () => {
  // Deep in the flat tail of the curve the slope is 0.03125/pt, so a 3-point
  // RT move leaves fantasy points unchanged at one decimal. RT is the headline
  // number now, so that still has to be reported.
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        {
          data: [{
            id: 'movie-1',
            title: 'Straight To Video',
            poster_url: null,
            fantasy_points: -19.28,
            combined_score: 8,
            announced_fantasy_points: -19.28,
            announced_rt_score: 5,
          }],
          error: null,
        },
      ],
      league_participants: [{ data: [{ id: 'p-b', league_id: 'league-1' }], error: null }],
      teams: [{ data: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null }],
      team_scores: [{ data: [{ team_id: 'team-b', total_points: 30.0 }], error: null }],
      discord_channels: [{ data: [enabledChannel()], error: null }],
    })

    const context = baseContext()
    context.previousMovieScores = new Map([['movie-1', { points: -19.28, rtScore: 5 }]])
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.movie_updates, 1)
    assertEquals(calls.length, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(
      embed.description,
      'Score has gone **UP** from **5% RT** (-19.3 pts) to **8% RT** (-19.3 pts)'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - no-ops when the movie is in no league', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({})
    const context = { ...baseContext(), leagueIds: [], placements: [] }

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.movie_updates, 0)
    assertEquals(calls.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - still posts standings when a dropped movie moves the score', async () => {
  // A dropped pick yields no placement, but its points still count toward the
  // owner's total, so the league must not be blacked out for the whole run.
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        { data: [{ id: 'movie-1', title: 'Dropped Film', poster_url: null, fantasy_points: 34.0, combined_score: 92 }], error: null },
      ],
      league_participants: [{ data: [{ id: 'p-b', league_id: 'league-1' }], error: null }],
      teams: [{ data: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null }],
      team_scores: [{ data: [{ team_id: 'team-b', total_points: 58.6 }], error: null }],
      discord_channels: [{ data: [enabledChannel()], error: null }],
    })

    const context = baseContext()
    context.placements = []
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.movie_updates, 0)
    assertEquals(summary.standings_updates, 1)
    assertEquals(calls.length, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(embed.title, 'Standings Update')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - folds movies past the cap into a rollup', async () => {
  const calls = mockWebhookFetch()
  try {
    const movieCount = 11
    const movies = Array.from({ length: movieCount }, (_, i) => ({
      id: `movie-${i}`,
      title: `Movie ${i}`,
      poster_url: null,
      // Mid-band of the curve, where points are simply RT - 60
      combined_score: 60 + i,
      fantasy_points: i,
    }))

    const { client } = createMockSupabase({
      movies: [{ data: movies, error: null }],
      league_participants: [{ data: [{ id: 'p-b', league_id: 'league-1' }], error: null }],
      teams: [{ data: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null }],
      team_scores: [{ data: [{ team_id: 'team-b', total_points: 30.0 }], error: null }],
      discord_channels: [{ data: [enabledChannel()], error: null }],
    })

    const context = baseContext()
    context.movieIds = movies.map((m) => m.id)
    context.previousMovieScores = new Map(
      movies.map((m) => [m.id, { points: null, rtScore: null }])
    )
    context.placements = movies.map((m) => ({
      movieId: m.id,
      leagueId: 'league-1',
      ownerTeamName: 'Bravo',
      counterpickerTeamName: null,
    }))
    // No standings movement, so every message is a movie message
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    await sendScoreNotifications(client, context)

    // 8 individual + 1 rollup for the remaining 3
    assertEquals(calls.length, 9)
    const rollup = (calls[8].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(rollup.title, '3 more movies scored')
    assertEquals((rollup.fields as unknown[]).length, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - reports an unscored movie as a new score', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        { data: [{ id: 'movie-1', title: 'Avatar Legends', poster_url: '/a.jpg', fantasy_points: 36.0, combined_score: 93 }], error: null },
      ],
      league_participants: [{ data: [{ id: 'p-b', league_id: 'league-1' }], error: null }],
      teams: [{ data: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null }],
      team_scores: [{ data: [{ team_id: 'team-b', total_points: 30.0 }], error: null }],
      discord_channels: [
        {
          data: [{
            id: 'ch-1',
            webhook_url: 'https://discord.com/api/webhooks/1/abc',
            thread_id: null,
            bid_alert_role_id: null,
            notify_drafts: true,
            notify_bids: true,
            notify_trades: true,
            notify_scores: true,
            consecutive_failures: 0,
          }],
          error: null,
        },
      ],
    })

    const context = baseContext()
    context.previousMovieScores = new Map([['movie-1', { points: null, rtScore: null }]])
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.movie_updates, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(embed.description, 'Now has a score of **93% RT** (36.0 pts)')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - respects the notify_scores channel preference', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 34.0, combined_score: 92 }], error: null },
      ],
      league_participants: [{ data: [{ id: 'p-b', league_id: 'league-1' }], error: null }],
      teams: [{ data: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null }],
      team_scores: [{ data: [{ team_id: 'team-b', total_points: 58.6 }], error: null }],
      discord_channels: [
        {
          data: [{
            id: 'ch-1',
            webhook_url: 'https://discord.com/api/webhooks/1/abc',
            thread_id: null,
            bid_alert_role_id: null,
            notify_drafts: true,
            notify_bids: true,
            notify_trades: true,
            notify_scores: false,
            consecutive_failures: 0,
          }],
          error: null,
        },
      ],
    })

    const context = baseContext()
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    await sendScoreNotifications(client, context)

    assertEquals(calls.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ============================================================================
// Notable miss (D2)
// ============================================================================

Deno.test('crossesNotableMissThreshold - true only when crossing from below 15 to at/above 15', () => {
  assertEquals(crossesNotableMissThreshold(5, 20), true)
  assertEquals(crossesNotableMissThreshold(null, 15), true, 'unscored counts as below the bar')
  assertEquals(crossesNotableMissThreshold(5, 15), true, 'exactly at the threshold counts')
  assertEquals(crossesNotableMissThreshold(20, 25), false, 'already above -- no resend')
  assertEquals(crossesNotableMissThreshold(10, 14), false, 'still below the bar')
})

/** Minimal fixture for the notable-miss dispatch tests below, using the
 * filtering mock client (_mock-client.ts) rather than createMockSupabase --
 * these need real insert-then-check dedup against discord_notification_log.
 * The movie was last posted at notableMissContext's pre-run score. */
function notableMissDb(fantasyPoints: number, rtScore: number): MockDb {
  return {
    movies: [{
      id: 'movie-1',
      title: 'Sequel Nobody Wanted',
      poster_url: null,
      fantasy_points: fantasyPoints,
      combined_score: rtScore,
      announced_fantasy_points: 5,
      announced_rt_score: 65,
    }],
    discord_notification_log: [],
    discord_channels: [
      {
        id: 'ch-1',
        league_id: 'league-1',
        webhook_url: 'https://discord.com/api/webhooks/1/token1',
        thread_id: null,
        bid_alert_role_id: null,
        enabled: true,
        notify_drafts: true,
        notify_bids: true,
        notify_trades: true,
        notify_scores: true,
        notify_weekly_digest: true,
        notify_movie_news: true,
        consecutive_failures: 0,
      },
    ],
  }
}

function notableMissContext(overrides: Partial<ScoreNotificationContext> = {}): ScoreNotificationContext {
  return {
    movieIds: ['movie-1'],
    leagueIds: ['league-1'],
    previousMovieScores: new Map([['movie-1', { points: 5, rtScore: 65 }]]),
    leagueNames: new Map([['league-1', 'The League']]),
    previousStandings: new Map(),
    placements: [],
    droppedPlacements: [{ movieId: 'movie-1', leagueId: 'league-1', droppedByTeamName: 'Dropper' }],
    ...overrides,
  }
}

Deno.test('sendScoreNotifications - notable miss: crosses threshold sends once, rerun does not resend', async () => {
  const calls = mockWebhookFetch()
  try {
    const db = notableMissDb(20, 80)
    const client = createMockDbClient(db)
    const context = notableMissContext()

    const first = await sendScoreNotifications(client, context)
    assertEquals(first.notable_misses, 1)
    assertEquals(calls.length, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(embed.title, '👀 The one that got away')
    assertStringIncludes(embed.description as string, '**80% RT** (20.0 pts)')
    assertEquals(db.discord_notification_log.length, 1)
    assertEquals(db.discord_notification_log[0].notification_type, 'notable_miss')
    assertEquals(db.discord_notification_log[0].movie_id, 'movie-1')

    const second = await sendScoreNotifications(client, context)
    assertEquals(second.notable_misses, 0)
    assertEquals(calls.length, 1, 'rerun must not resend')
    assertEquals(db.discord_notification_log.length, 1, 'log is not duplicated')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - notable miss: below threshold sends nothing', async () => {
  const calls = mockWebhookFetch()
  try {
    const db = notableMissDb(10, 70)
    const client = createMockDbClient(db)
    const context = notableMissContext()

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.notable_misses, 0)
    assertEquals(calls.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - completed seasons get no movie, standings, or notable-miss updates', async () => {
  const calls = mockWebhookFetch()
  try {
    const db = notableMissDb(34, 92)
    db.leagues = [{ id: 'league-1', status: 'completed' }]
    const client = createMockDbClient(db)
    const context = notableMissContext({ placements: baseContext().placements })

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary, {
      movie_updates: 0, standings_updates: 0, leagues_with_changes: 0, notable_misses: 0,
    })
    assertEquals(calls.length, 0)
    assertEquals(db.discord_notification_log, [])
    assertEquals(context.leagueIds, ['league-1'], 'the before snapshot is not mutated')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - a shared movie still notifies its active season', async () => {
  const calls = mockWebhookFetch()
  try {
    const db = notableMissDb(34, 92)
    db.leagues = [
      { id: 'league-1', status: 'completed' },
      { id: 'league-2', status: 'active' },
    ]
    db.discord_channels.push({ ...db.discord_channels[0], id: 'ch-2', league_id: 'league-2' })
    const context = baseContext()
    context.leagueIds.push('league-2')
    context.placements.push({ ...context.placements[0], leagueId: 'league-2' })
    context.droppedPlacements = [{
      movieId: 'movie-1', leagueId: 'league-1', droppedByTeamName: 'Dropper',
    }]

    const summary = await sendScoreNotifications(createMockDbClient(db), context)

    assertEquals(summary.movie_updates, 1)
    assertEquals(summary.leagues_with_changes, 1)
    assertEquals(summary.notable_misses, 0)
    assertEquals(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - skips dispatch if season status cannot be read', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client, reads } = createMockSupabase({
      leagues: [{ data: null, error: { message: 'database unavailable' } }],
    })

    const summary = await sendScoreNotifications(client, baseContext())

    assertEquals(summary.leagues_with_changes, 0)
    assertEquals(calls.length, 0)
    assertEquals(reads, ['leagues'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - notable miss: only dropped placements qualify, not active ones', async () => {
  const calls = mockWebhookFetch()
  try {
    const db = notableMissDb(20, 80)
    const client = createMockDbClient(db)
    // Same crossing score, but the movie is actively rostered (not dropped) --
    // per the scope decision, this must never fire "the one that got away".
    const context = notableMissContext({
      droppedPlacements: [],
      placements: [
        { movieId: 'movie-1', leagueId: 'league-1', ownerTeamName: 'Current Holder', counterpickerTeamName: null },
      ],
    })

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.notable_misses, 0)
    // The crossing score still posts as a normal movie update, just never as
    // a "got away" roast.
    assertEquals(calls.length, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(embed.title, 'Sequel Nobody Wanted')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - notable miss fires on a step too small to post', async () => {
  const calls = mockWebhookFetch()
  try {
    // A dropped movie edging from 14 to 16 points crosses the 15-point bar
    const db = notableMissDb(16, 76)
    Object.assign(db.movies[0], { announced_fantasy_points: 14, announced_rt_score: 74 })
    const context = notableMissContext({
      previousMovieScores: new Map([['movie-1', { points: 14, rtScore: 74 }]]),
    })

    const summary = await sendScoreNotifications(createMockDbClient(db), context)

    assertEquals(summary.notable_misses, 1)
    assertEquals(calls.length, 1)
    assertEquals(db.movies[0].announced_fantasy_points, 14, 'two points is still not a score post')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ============================================================================
// Last-posted score (movies.announced_*)
// ============================================================================

type Score = { points: number; rtScore: number }

/**
 * Bravo holding one movie, on the filtering mock client so a test can follow
 * the last-posted score from one run to the next.
 */
function slowBurnDb(current: Score, announced: Score, teamTotal: number): MockDb {
  return {
    movies: [{
      id: 'movie-1',
      title: 'Slow Burn',
      poster_url: null,
      fantasy_points: current.points,
      combined_score: current.rtScore,
      announced_fantasy_points: announced.points,
      announced_rt_score: announced.rtScore,
    }],
    league_participants: [{ id: 'p-b', league_id: 'league-1', status: 'active' }],
    teams: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }],
    team_scores: [{ team_id: 'team-b', total_points: teamTotal }],
    discord_channels: [enabledChannel({ league_id: 'league-1', enabled: true })],
  }
}

function slowBurnContext(preRun: Score, teamTotal: number): ScoreNotificationContext {
  return {
    ...baseContext(),
    previousMovieScores: new Map([['movie-1', preRun]]),
    previousStandings: new Map([['league-1', [standing('team-b', 'Bravo', teamTotal, 1)]]]),
  }
}

Deno.test('sendScoreNotifications - holds back a move under 3 and keeps the last-posted score', async () => {
  const calls = mockWebhookFetch()
  try {
    // A two-point move, which also moves the team two
    const db = slowBurnDb({ points: 22, rtScore: 82 }, { points: 20, rtScore: 80 }, 32)

    const summary = await sendScoreNotifications(
      createMockDbClient(db),
      slowBurnContext({ points: 20, rtScore: 80 }, 30)
    )

    assertEquals(summary.movie_updates, 0)
    assertEquals(summary.standings_updates, 0)
    assertEquals(calls.length, 0)
    assertEquals(db.movies[0].announced_rt_score, 80, 'the gap carries into the next run')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - posts a drift once it adds up, measured from the last post', async () => {
  const calls = mockWebhookFetch()
  try {
    // Posted at 80%, then a point a run: 81 and 82 stayed under the bar
    const db = slowBurnDb({ points: 23, rtScore: 83 }, { points: 20, rtScore: 80 }, 33)
    const client = createMockDbClient(db)

    const summary = await sendScoreNotifications(client, slowBurnContext({ points: 22, rtScore: 82 }, 32))

    assertEquals(summary.movie_updates, 1)
    assertEquals(summary.standings_updates, 0, 'the team only moved 1 this run')
    assertEquals(calls.length, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(
      embed.description,
      'Score has gone **UP** from **80% RT** (20.0 pts) to **83% RT** (23.0 pts)'
    )
    assertEquals(db.movies[0].announced_rt_score, 83)
    assertEquals(db.movies[0].announced_fantasy_points, 23)

    // The next run measures from the new post, so holding steady stays quiet
    const rerun = await sendScoreNotifications(client, slowBurnContext({ points: 23, rtScore: 83 }, 33))
    assertEquals(rerun.movie_updates, 0)
    assertEquals(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - holds a post back when its score cannot be recorded', async () => {
  // Posting without recording would post the same move again next run.
  // Holding it keeps the gap open, so the next run posts it exactly once.
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 34.0, combined_score: 92, ...ANNOUNCED_AT_SNAPSHOT }], error: null },
        // The last-posted score write
        { data: null, error: { message: 'write failed' } },
      ],
      league_participants: [{ data: [{ id: 'p-b', league_id: 'league-1' }], error: null }],
      teams: [{ data: [{ id: 'team-b', name: 'Bravo', participant_id: 'p-b' }], error: null }],
      team_scores: [{ data: [{ team_id: 'team-b', total_points: 30.0 }], error: null }],
      discord_channels: [{ data: [enabledChannel()], error: null }],
    })

    const context = baseContext()
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.movie_updates, 0)
    assertEquals(calls.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
