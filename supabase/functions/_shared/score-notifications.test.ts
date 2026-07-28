/**
 * Unit tests for score notification building and dispatch.
 *
 * Run with: deno task test:unit
 */

import { assertEquals, assertExists, assertStringIncludes } from '@std/assert'
import {
  captureScoreContext,
  formatPoints,
  ordinal,
  rankStandings,
  diffStandings,
  buildMovieScoreEmbed,
  buildStandingsEmbed,
  sendScoreNotifications,
  type MoviePlacement,
  type ScoreNotificationContext,
  type StandingChange,
  type TeamStanding,
} from './score-notifications.ts'
import { DISCORD_COLORS } from './discord.ts'

// ============================================================================
// Formatting
// ============================================================================

Deno.test('formatPoints - renders one decimal place', () => {
  assertEquals(formatPoints(80.34), '80.3')
  assertEquals(formatPoints(45), '45.0')
  assertEquals(formatPoints(-12.567), '-12.6')
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
      newPoints: 80.3,
      isNewScore: true,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(embed.title, 'Splatoon Raiders')
  assertEquals(embed.description, 'Now has a score of **80.3**')
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
      previousPoints: 81.2,
      newPoints: 82.7,
      isNewScore: false,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(embed.description, 'Score has gone **UP** from **81.2** to **82.7**')
  assertEquals(embed.color, DISCORD_COLORS.green)
  assertEquals(embed.thumbnail, undefined)
})

Deno.test('buildMovieScoreEmbed - falling score is crimson and reads DOWN', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Splatoon Raiders',
      posterUrl: null,
      previousPoints: 57.2,
      newPoints: 45.7,
      isNewScore: false,
    },
    placement,
    'MoC Fantasy League'
  )

  assertEquals(embed.description, 'Score has gone **DOWN** from **57.2** to **45.7**')
  assertEquals(embed.color, DISCORD_COLORS.crimson)
})

Deno.test('buildMovieScoreEmbed - includes counterpicker when present', () => {
  const embed = buildMovieScoreEmbed(
    {
      movieId: 'movie-1',
      title: 'Avatar Legends',
      posterUrl: null,
      previousPoints: null,
      newPoints: 12.5,
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

function baseContext(): ScoreNotificationContext {
  return {
    movieIds: ['movie-1'],
    leagueIds: ['league-1'],
    previousMoviePoints: new Map([['movie-1', 20.0]]),
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
    movies: [{ data: [{ id: 'movie-1', fantasy_points: null }], error: null }],
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
    movies: [{ data: [{ id: 'movie-1', fantasy_points: 20 }], error: null }],
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
    movies: [{ data: [{ id: 'movie-1', fantasy_points: null }], error: null }],
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
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 35.0 }], error: null },
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
    assertEquals(movieEmbed.description, 'Score has gone **UP** from **20.0** to **35.0**')

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
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 20.0 }], error: null },
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
        { data: [{ id: 'movie-1', title: 'Dropped Film', poster_url: null, fantasy_points: 35.0 }], error: null },
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
      fantasy_points: 50 + i,
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
    context.previousMoviePoints = new Map(movies.map((m) => [m.id, null]))
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
        { data: [{ id: 'movie-1', title: 'Avatar Legends', poster_url: '/a.jpg', fantasy_points: 80.3 }], error: null },
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
    context.previousMoviePoints = new Map([['movie-1', null]])
    context.previousStandings = new Map([['league-1', [standing('team-b', 'Bravo', 30.0, 1)]]])

    const summary = await sendScoreNotifications(client, context)

    assertEquals(summary.movie_updates, 1)
    const embed = (calls[0].embeds as Array<Record<string, unknown>>)[0]
    assertEquals(embed.description, 'Now has a score of **80.3**')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('sendScoreNotifications - respects the notify_scores channel preference', async () => {
  const calls = mockWebhookFetch()
  try {
    const { client } = createMockSupabase({
      movies: [
        { data: [{ id: 'movie-1', title: 'Splatoon Raiders', poster_url: null, fantasy_points: 35.0 }], error: null },
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
