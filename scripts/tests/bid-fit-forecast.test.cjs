const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

/** Transpile a TypeScript module with no imports and return its exports. */
function loadModule(relativePath) {
  const source = readFileSync(resolve(__dirname, '../..', relativePath), 'utf8')
  // ES2022 keeps for...of over Sets and Maps intact; lower targets drop it.
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exported = {}
  new Script(compiled).runInNewContext({ exports: exported })
  return exported
}

// The bid priority list's cut line must agree with process-bids about which
// bids land, so exercise the real forecast and the real resolver.
const { forecastBidFits, getDroppableBidHoldingIds } = loadModule(
  'apps/frontend/app/(authenticated)/league/[id]/components/bidFitForecast.ts',
)
const { resolveBidWinners, droppableHoldingIds } = loadModule('supabase/functions/_shared/bid-resolution.ts')

function forecast(targets, freeSlots, remainingDrops = targets.length, droppable = ['h1', 'h2']) {
  return forecastBidFits(targets, {
    freeSlots,
    remainingDrops,
    droppableHoldingIds: new Set(droppable),
  })
}

test('two bids naming the same drop target on a full roster: only the higher priority lands', () => {
  assert.deepEqual(forecast(['h1', 'h1'], 0), ['drop', null])
})

test('distinct drop targets each bring their own room on a full roster', () => {
  assert.deepEqual(forecast([null, 'h1', 'h2', null], 0), [null, 'drop', 'drop', null])
})

test('a free slot is spent before a conditional drop, as processing does', () => {
  // The drop carrier takes the open slot and keeps its holding, so the plain
  // bid ranked behind it has nowhere to go.
  assert.deepEqual(forecast(['h1', null], 1), ['slot', null])
  assert.deepEqual(forecast(['h1', 'h1'], 1, 1), ['slot', 'drop'])
})

test('once slots run out, a drop carrier still lands below plain bids that do not', () => {
  assert.deepEqual(forecast([null, null, 'h1'], 1), ['slot', null, 'drop'])
})

test('plain bids fill free slots in priority order', () => {
  assert.deepEqual(forecast([null, null, null, null], 2), ['slot', 'slot', null, null])
})

test('drop allowance is spent only when a drop supplies room', () => {
  assert.deepEqual(forecast(['h1', 'h2'], 0, 0), [null, null])
  assert.deepEqual(forecast(['h1', 'h2'], 0, 1), ['drop', null])
  assert.deepEqual(forecast(['h1', 'h2'], 1, 0), ['slot', null])
})

test('an ineligible target cannot supply room or consume drop allowance', () => {
  assert.deepEqual(forecast(['h1', 'h2'], 0, 1, ['h2']), [null, 'drop'])
  assert.deepEqual(forecast(['h1', 'h2'], 1, 1, ['h2']), ['slot', 'drop'])
})

test('eligible holdings match processing for release and counterpick rules', () => {
  const holdings = [
    { holding_id: 'released', movie_id: 'm1', release_date: '2026-09-26', counterpicked_by_team_id: null },
    { holding_id: 'today', movie_id: 'm2', release_date: '2026-09-27', counterpicked_by_team_id: null },
    { holding_id: 'unknown-release', movie_id: 'm3', release_date: null, counterpicked_by_team_id: null },
    { holding_id: 'counterpicked', movie_id: 'm4', release_date: '2027-01-01', counterpicked_by_team_id: 'other-team' },
    { holding_id: 'contested', movie_id: 'm5', release_date: '2027-01-01', counterpicked_by_team_id: null },
  ]
  const contestedMovieIds = new Set(['m5'])
  for (const counterpicksBlockDrops of [false, true]) {
    const options = { today: '2026-09-27', counterpicksBlockDrops }
    const actual = [...getDroppableBidHoldingIds(holdings, { ...options, contestedMovieIds })]
    const expected = [...droppableHoldingIds(holdings.map((holding) => ({
      holdingId: holding.holding_id,
      releaseDate: holding.release_date,
      counterpickedByTeamId: holding.counterpicked_by_team_id,
      hasPendingCounterpickBid: contestedMovieIds.has(holding.movie_id),
    })), options)]
    assert.deepEqual(actual, expected)
    assert.deepEqual(actual, counterpicksBlockDrops
      ? ['today', 'unknown-release']
      : ['today', 'unknown-release', 'counterpicked', 'contested'])
  }
})

test('the forecast matches the resolver for every small single-team week', () => {
  // Every priority-ordered list of up to four uncontested bids, each with no
  // drop or one of two drop targets. Vary slots, allowance, and eligible targets;
  // budget is ample because the UI's roster forecast leaves that to the server.
  let lists = [[]]
  for (let length = 1; length <= 4; length++) {
    lists = lists.flatMap((list) => [null, 'h1', 'h2'].map((target) => [...list, target]))

    for (const targets of lists) {
      const contests = targets.map((target, index) => ({
        key: `movie-${index}`,
        activeBids: [{
          id: `bid-${index}`,
          team_id: 'team',
          amount: 1,
          priority: index + 1,
          created_at: '2026-01-01T00:00:00Z',
          conditionalDropHoldingId: target,
        }],
      }))
      for (const freeSlots of [0, 1, 2]) {
        for (const remainingDrops of [0, 1, 2, 4]) {
          for (const droppable of [[], ['h1'], ['h2'], ['h1', 'h2']]) {
            const capacity = {
              freeSlots,
              remainingBudget: Number.MAX_SAFE_INTEGER,
              remainingDrops,
              droppableHoldingIds: new Set(droppable),
            }

            const { winners, executedDrops } = resolveBidWinners(contests, new Map([['team', capacity]]))
            assert.deepEqual(
              forecast(targets, freeSlots, remainingDrops, droppable),
              contests.map((contest) => {
                const winner = winners.get(contest.key)
                return winner ? executedDrops.has(winner.id) ? 'drop' : 'slot' : null
              }),
              JSON.stringify({ freeSlots, remainingDrops, droppable, targets }),
            )
          }
        }
      }
    }
  }
})
