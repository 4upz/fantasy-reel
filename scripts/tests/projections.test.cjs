const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

/** Transpile a frontend module, resolving its imports from `modules`. */
function loadModule(relativePath, modules = {}) {
  const source = readFileSync(resolve(__dirname, '../../apps/frontend', relativePath), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported = {}
  const require = (name) => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`)
    return modules[name]
  }
  new Script(compiled).runInNewContext({ exports: exported, require, Date, Intl, queueMicrotask })
  return exported
}

const date = loadModule('utils/date.ts')
const scoring = loadModule('utils/scoring.ts', { '@/utils/date': date })
const projections = loadModule('utils/projections.ts')
const { computeProjectedStandings, hasProjectedLegs } = loadModule('utils/projectedStandings.ts', {
  '@/utils/date': date,
  '@/utils/scoring': scoring,
})

const now = new Date('2026-10-06T12:00:00Z')

/** Values built inside the module's own context have its prototypes; compare their data. */
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message)

function projection(overrides = {}) {
  return {
    tmdb_id: 1,
    projected_rt: 76,
    range50: [72, 80],
    range80: [64, 86],
    low_confidence: false,
    insufficient_history: false,
    p_rotten: 0.12,
    p_fresh: 0.88,
    p_90: 0.08,
    expected_points: 16,
    baseline_rt: 61,
    contributions: [
      { factor: 'director', label: 'Director', delta_rt: 9 },
      { factor: 'writers', label: 'Writers', delta_rt: 3 },
      { factor: 'studio', label: 'Studio and festival', delta_rt: 4 },
      { factor: 'cast', label: 'Cast', delta_rt: -1 },
    ],
    coverage: 0.8,
    partial: false,
    includes_early_reviews: false,
    early_rt: null,
    computed_at: '2026-10-06T08:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------- chip copy

test('a tight range reads as the middle-50% range', () => {
  const state = projections.projectionChipState(projection({ range50: [68.4, 78.2] }))
  same(state, { kind: 'range', low: 68, high: 78 })
  assert.equal(projections.projectionChipLabel(state), 'Proj. 68–78%')
})

test('a range wider than 10 points falls back to the point estimate, tagged', () => {
  const wide = projections.projectionChipState(projection({ range50: [60, 80.5], projected_rt: 73.6 }))
  same(wide, { kind: 'point', value: 74, lowConfidence: true })
  assert.equal(projections.projectionChipLabel(wide), 'Proj. 74%')
  // The server's flag wins even when the numbers alone look tight.
  const flagged = projections.projectionChipState(projection({ low_confidence: true }))
  assert.equal(flagged.kind === 'point' && flagged.lowConfidence, true)
  assert.equal(projections.projectionTone(projection({ low_confidence: true })), 'uncertain')
})

test('exactly 10 points wide is still a range', () => {
  assert.equal(projections.projectionChipState(projection({ range50: [70, 80] })).kind, 'range')
})

test('too little history shows no number; early reviews win over everything', () => {
  const thin = projections.projectionChipState(projection({ insufficient_history: true }))
  assert.equal(projections.projectionChipLabel(thin), 'Not enough history yet')
  const early = projections.projectionChipState(
    projection({ insufficient_history: true, early_rt: { score: 87.6, reviews: 24 } })
  )
  assert.equal(projections.projectionChipLabel(early), 'Early RT 88% (24 reviews)')
  assert.equal(
    projections.projectionChipLabel(projections.projectionChipState(projection({ early_rt: { score: 50, reviews: 1 } }))),
    'Early RT 50% (1 review)'
  )
})

test('every chip state has a spoken reading with no abbreviation or dash', () => {
  const read = (overrides) => projections.projectionChipSpokenLabel(projections.projectionChipState(projection(overrides)))
  assert.equal(read({ range50: [68.4, 78.2] }), 'Projected 68 to 78%')
  assert.equal(read({ range50: [60, 80.5], projected_rt: 73.6 }), 'Projected about 74%')
  assert.equal(read({ insufficient_history: true }), 'Projected score: not enough history yet')
  assert.equal(read({ early_rt: { score: 87.6, reviews: 24 } }), 'Early Rotten Tomatoes score 88%, 24 reviews')
  assert.equal(read({ early_rt: { score: 50, reviews: 1 } }), 'Early Rotten Tomatoes score 50%, 1 review')
})

test('tone follows the 60% break-even', () => {
  assert.equal(projections.projectionTone(projection()), 'fresh')
  assert.equal(projections.projectionTone(projection({ projected_rt: 48, range50: [44, 52] })), 'rotten')
})

test('a counterpick scores the negation of the expected points', () => {
  assert.equal(projections.projectedPointsFor(projection()), 16)
  assert.equal(projections.projectedPointsFor(projection(), true), -16)
})

test('chances never claim certainty', () => {
  assert.equal(projections.formatChance(0.123), '12%')
  assert.equal(projections.formatChance(0.001), '<1%')
  assert.equal(projections.formatChance(0.999), '>99%')
})

test('the stacked bar walks from the baseline to the projection', () => {
  const factors = projections.projectionFactors(projection())
  same(factors.map((f) => f.key), ['director', 'studio', 'writers', 'cast'])
  const segments = projections.projectionBarSegments(61, factors)
  same(segments, [
    { key: 'baseline', start: 0, width: 61, positive: true },
    { key: 'director', start: 61, width: 9, positive: true },
    { key: 'studio', start: 70, width: 4, positive: true },
    { key: 'writers', start: 74, width: 3, positive: true },
    { key: 'cast', start: 76, width: 1, positive: false },
  ])
})

test('a long tail of factors folds into one line', () => {
  const contributions = [9, -6, 5, 4, 3, 2, 1].map((delta, i) => ({ factor: `f${i}`, label: `F${i}`, delta_rt: delta }))
  const factors = projections.projectionFactors(projection({ contributions }))
  assert.equal(factors.length, 5)
  same(factors[4], { key: 'other', label: 'Other factors', delta: 3 + 2 + 1 })
})

test('the bar stays inside 0-100', () => {
  const segments = projections.projectionBarSegments(95, [{ key: 'a', label: 'A', delta: 12 }])
  same(segments.map((s) => s.start + s.width), [95, 100])
})

// ------------------------------------------------------- projected standings

const teams = [
  { team_id: 'sharks', team_name: "Spielberg's Sharks", earned: 37, rank: 2 },
  { team_id: 'paradox', team_name: "Nolan's Paradox", earned: 44, rank: 1 },
  { team_id: 'cut', team_name: 'Coppola Cut', earned: 29, rank: 3 },
]

const released = { release_date: '2026-06-01', combined_score: 83 }
const upcoming = { release_date: '2026-11-14', combined_score: null, fantasy_points: null }

function standingsFor({ holdings, counterpicks = [], byId, double = false }) {
  return computeProjectedStandings({
    teams,
    holdings,
    counterpicks,
    projections: new Map(Object.entries(byId).map(([id, p]) => [Number(id), p])),
    doublePointsOver90: double,
    now,
  })
}

test('projected total = earned + expected points of what has not counted', () => {
  const standings = standingsFor({
    holdings: [
      { team_id: 'sharks', tmdb_id: 10, title: 'Gold Coast', ...released, fantasy_points: 23 },
      { team_id: 'sharks', tmdb_id: 11, title: 'The Lantern Keeper', ...upcoming },
      { team_id: 'sharks', tmdb_id: 12, title: 'Night Shift 3', ...upcoming },
      { team_id: 'paradox', tmdb_id: 20, title: 'Orbit Down', ...upcoming },
    ],
    byId: {
      11: projection({ tmdb_id: 11, expected_points: 16 }),
      12: projection({ tmdb_id: 12, expected_points: 7 }),
      20: projection({ tmdb_id: 20, expected_points: -10 }),
    },
  })
  const byTeam = Object.fromEntries(standings.map((t) => [t.team_id, t]))
  // Earned is the server's total; the released movie is inside it, not added again.
  assert.equal(byTeam.sharks.projected, 37 + 16 + 7)
  assert.equal(byTeam.sharks.remaining, 2)
  assert.equal(byTeam.paradox.projected, 34)
  same(standings.map((t) => t.team_id), ['sharks', 'paradox', 'cut'])
  assert.equal(byTeam.sharks.projectedRank, 1)
  assert.equal(byTeam.sharks.rankChange, 1)
  assert.equal(byTeam.paradox.rankChange, -1)
  // Real rank is untouched.
  assert.equal(byTeam.paradox.currentRank, 1)
  assert.equal(hasProjectedLegs(standings), true)
})

test('a counterpick adds the negation of its target movie', () => {
  const standings = standingsFor({
    holdings: [{ team_id: 'sharks', tmdb_id: 11, title: 'The Lantern Keeper', ...upcoming }],
    counterpicks: [{ counterpicker_team_id: 'cut', tmdb_id: 11, title: 'The Lantern Keeper', ...upcoming }],
    byId: { 11: projection({ tmdb_id: 11, expected_points: 16 }) },
  })
  const cut = standings.find((t) => t.team_id === 'cut')
  assert.equal(cut.projected, 29 - 16)
  assert.equal(cut.legs[0].counterpick, true)
  assert.equal(cut.legs[0].points, -16)
})

test('a released counterpick is already earned; an unreleased pre-release score stands in without a projection', () => {
  const standings = standingsFor({
    holdings: [{ team_id: 'cut', tmdb_id: 30, title: 'Paper Moons', release_date: '2026-12-05', combined_score: 70, fantasy_points: 10 }],
    counterpicks: [{ counterpicker_team_id: 'cut', tmdb_id: 31, title: 'Second Wind', ...released, fantasy_points: -4 }],
    byId: { 30: null, 31: null },
  })
  const cut = standings.find((t) => t.team_id === 'cut')
  same(cut.legs.map((leg) => leg.basis), ['pre_release', 'earned'])
  assert.equal(cut.projected, 29 + 10)
  // No leg rests on a projection, so there is nothing to show.
  assert.equal(hasProjectedLegs(standings), false)
})

test('a movie with no projection, or too little history, adds nothing', () => {
  const standings = standingsFor({
    holdings: [
      { team_id: 'cut', tmdb_id: 40, title: 'Unknown', ...upcoming },
      { team_id: 'cut', tmdb_id: 41, title: 'Thin', ...upcoming },
    ],
    byId: { 40: null, 41: projection({ tmdb_id: 41, insufficient_history: true, expected_points: 30 }) },
  })
  const cut = standings.find((t) => t.team_id === 'cut')
  same(cut.legs.map((leg) => leg.basis), ['none', 'none'])
  assert.equal(cut.projected, 29)
})

test('equal projected totals share a competition rank', () => {
  const standings = standingsFor({
    holdings: [{ team_id: 'cut', tmdb_id: 50, title: 'Catch-up', ...upcoming }],
    byId: { 50: projection({ tmdb_id: 50, expected_points: 8 }) },
  })
  const ranks = standings.map((t) => [t.team_id, t.projectedRank, t.isTied])
  same(ranks, [
    ['paradox', 1, false],
    ['sharks', 2, true],
    ['cut', 2, true],
  ])
})

test('a gap small next to the remaining uncertainty is a toss-up', () => {
  const close = standingsFor({
    holdings: [{ team_id: 'cut', tmdb_id: 60, title: 'Wildcard', ...upcoming }],
    byId: { 60: projection({ tmdb_id: 60, expected_points: 6, range80: [40, 95] }) },
  })
  const cut = close.find((t) => t.team_id === 'cut')
  assert.equal(cut.projected, 35)
  assert.ok(cut.uncertainty > 10)
  assert.equal(cut.tossUp, true)

  const certain = standingsFor({
    holdings: [{ team_id: 'cut', tmdb_id: 60, title: 'Sure thing', ...upcoming }],
    byId: { 60: projection({ tmdb_id: 60, expected_points: 6, range80: [74, 76] }) },
  })
  assert.equal(certain.find((t) => t.team_id === 'cut').tossUp, false)
})

test('the uncertainty is measured under the season rule', () => {
  const run = (double) =>
    standingsFor({
      holdings: [{ team_id: 'cut', tmdb_id: 70, title: 'Prestige', ...upcoming }],
      byId: { 70: projection({ tmdb_id: 70, range80: [80, 98] }) },
      double,
    }).find((t) => t.team_id === 'cut').uncertainty
  assert.ok(run(true) > run(false))
})

// ------------------------------------------------------------- store gating

function loadStore(responder) {
  const calls = []
  const movieQueries = []
  const store = loadModule('utils/projectionStore.ts', {
    '@/utils/supabase/functions': {
      callEdgeFunction: async (name, options) => {
        calls.push({ name, body: options.body })
        return responder(options.body)
      },
    },
    '@/utils/supabase/client': {
      createClient: () => ({
        from: () => ({
          select: () => ({
            in: async (_column, ids) => {
              movieQueries.push(ids)
              return { data: ids.map((id, i) => ({ id, tmdb_id: 900 + i })) }
            },
          }),
        }),
      }),
    },
  })
  return { store, calls, movieQueries }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a league answered off is asked once and never again', async () => {
  const { store, calls } = loadStore(() => ({ data: { enabled: false }, error: null }))
  store.requestProjections('league-off', [1, 2, 3])
  store.requestProjections('league-off', [4])
  await settle()
  assert.equal(calls.length, 1, 'ids asked for in the same tick share one request')
  same(calls[0].body, { league_id: 'league-off', tmdb_ids: [1, 2, 3, 4] })
  assert.equal(store.enabledProjections('league-off'), null)
  assert.equal(store.projectionsDisabled('league-off'), true)
  store.requestProjections('league-off', [5])
  await settle()
  assert.equal(calls.length, 1)
})

test('an error or a missing function reads as off', async () => {
  const { store, calls } = loadStore(() => ({ data: null, error: 'Requested function was not found' }))
  store.requestProjections('league-404', [1])
  await settle()
  assert.equal(store.enabledProjections('league-404'), null)
  store.requestProjections('league-404', [2])
  await settle()
  assert.equal(calls.length, 1)
})

test('an enabled league batches at most 100 ids, probing first and never asking twice', async () => {
  const { store, calls } = loadStore(({ tmdb_ids }) => ({
    data: {
      enabled: true,
      model_version: 1,
      projections: Object.fromEntries(tmdb_ids.map((id) => [String(id), id % 2 ? projection({ tmdb_id: id }) : null])),
    },
    error: null,
  }))
  const ids = Array.from({ length: 250 }, (_, i) => i + 1)
  store.requestProjections('league-on', ids)
  await settle()
  await settle()
  same(calls.map((c) => c.body.tmdb_ids.length), [100, 100, 50])
  const loaded = store.enabledProjections('league-on')
  assert.equal(loaded.size, 250)
  assert.equal(loaded.get(2), null)
  assert.equal(loaded.get(3).tmdb_id, 3)
  store.requestProjections('league-on', [1, 2, 3])
  await settle()
  assert.equal(calls.length, 3)
})

test('leagues are cached separately', async () => {
  const { store } = loadStore(({ league_id }) => ({
    data: league_id === 'on' ? { enabled: true, model_version: 1, projections: { 7: projection({ tmdb_id: 7 }) } } : { enabled: false },
    error: null,
  }))
  store.requestProjections('on', [7])
  store.requestProjections('off', [7])
  await settle()
  assert.equal(store.enabledProjections('on').get(7).tmdb_id, 7)
  assert.equal(store.enabledProjections('off'), null)
})

test('movie ids resolve to TMDb ids in one query, once each', async () => {
  const { store, movieQueries } = loadStore(() => ({ data: { enabled: false }, error: null }))
  store.resolveMovieIds(['a', 'b'])
  store.resolveMovieIds(['b', 'c'])
  await settle()
  same(movieQueries, [['a', 'b', 'c']])
  assert.equal(store.tmdbIdForMovie('c'), 902)
  store.resolveMovieIds(['a'])
  await settle()
  assert.equal(movieQueries.length, 1)
})
