import { assertEquals } from '@std/assert'
import { buildMovieInboxRows, formatSignedPoints, type MovieInboxEvent, type MovieStake } from './movie-inbox.ts'

const leagues = new Map([
  ['L1', { id: 'L1', name: 'Office Movie Club', status: 'active', double_points_over_90: false }],
  ['L2', { id: 'L2', name: 'Old Season', status: 'completed', double_points_over_90: false }],
  ['L3', { id: 'L3', name: 'Double League', status: 'active', double_points_over_90: true }],
])
const members = new Map([
  ['L1', [
    { userId: 'alice', teamId: 'T-alice', teamName: 'Reel Deal' },
    { userId: 'bob', teamId: 'T-bob', teamName: 'Nolan Fans' },
    { userId: 'carol', teamId: 'T-carol', teamName: 'Coppola Co' },
  ]],
  ['L3', [{ userId: 'alice', teamId: 'T3-alice', teamName: 'Alice Again' }]],
])
const stake = (overrides: Partial<MovieStake> = {}): MovieStake => ({
  leagueId: 'L1',
  movieId: 'M1',
  holder: { teamId: 'T-alice', teamName: 'Reel Deal' },
  counterpicker: { teamId: 'T-bob', teamName: 'Nolan Fans' },
  ...overrides,
})
const event = (overrides: Partial<MovieInboxEvent> = {}): MovieInboxEvent => ({
  movieId: 'M1', title: 'Dune: Part Three', kind: 'scored', rtScore: 96, points: 36, released: true, ...overrides,
})

Deno.test('points read like the app: signed, whole unless the curve gave a fraction', () => {
  assertEquals(formatSignedPoints(36), '+36')
  assertEquals(formatSignedPoints(-4), '−4')
  assertEquals(formatSignedPoints(-16.25), '−16.3')
  assertEquals(formatSignedPoints(0), '+0')
})

Deno.test('a first score tells the holder, the counterpicker (inverted) and the rest of the league', () => {
  const rows = buildMovieInboxRows([event()], leagues, members, [stake()])
  assertEquals(rows.map((r) => [r.user_id, r.type]), [
    ['alice', 'movie_scored'],
    ['bob', 'movie_scored'],
    ['carol', 'league_movie_scored'],
  ])
  assertEquals(rows[0].title, 'Dune: Part Three scored 96%')
  assertEquals(rows[0].body, "That's +36 points for Reel Deal in Office Movie Club.")
  assertEquals(rows[1].title, 'Your counterpick on Dune: Part Three scored 96%')
  assertEquals(rows[1].body, "That's −36 points for Nolan Fans in Office Movie Club.")
  assertEquals(rows[1].data.points, -36)
  assertEquals(rows[2].body, "Reel Deal's movie in Office Movie Club: +36 points.")
})

Deno.test('moves and release-day news reach only the teams with a stake', () => {
  const moved = buildMovieInboxRows([event({ kind: 'moved', rtScore: 88, points: 28 })], leagues, members, [stake()])
  assertEquals(moved.map((r) => r.user_id), ['alice', 'bob'])
  assertEquals(moved[0].title, 'Dune: Part Three moved to 88%')

  const released = buildMovieInboxRows(
    [event({ kind: 'released', rtScore: null, points: null })], leagues, members, [stake({ counterpicker: null })],
  )
  assertEquals(released.map((r) => [r.user_id, r.type, r.title]), [
    ['alice', 'movie_released', 'Dune: Part Three is out today'],
  ])
})

Deno.test('a pre-release score says when it counts', () => {
  const [row] = buildMovieInboxRows([event({ released: false })], leagues, members, [stake({ counterpicker: null })])
  assertEquals(row.body, 'Worth +36 points for Reel Deal in Office Movie Club once it releases.')
  const counts = buildMovieInboxRows([event({ kind: 'counts' })], leagues, members, [stake({ counterpicker: null })])
  assertEquals(counts[0].title, "Dune: Part Three's score now counts")
  assertEquals(counts[0].body, 'It is worth +36 points for Reel Deal in Office Movie Club.')
})

Deno.test('completed seasons are quiet; double points apply per league', () => {
  const rows = buildMovieInboxRows([event()], leagues, members, [
    stake({ leagueId: 'L2' }),
    stake({ leagueId: 'L3', holder: { teamId: 'T3-alice', teamName: 'Alice Again' }, counterpicker: null }),
  ])
  assertEquals(rows.map((r) => [r.league_id, r.user_id, r.data.points]), [['L3', 'alice', 42]])
})

Deno.test('a counterpick on a dropped movie still tells the counterpicker', () => {
  const rows = buildMovieInboxRows([event({ kind: 'moved' })], leagues, members, [stake({ holder: null })])
  assertEquals(rows.map((r) => r.user_id), ['bob'])
})
