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
const { forecastBidFits: forecast } = loadModule(
  'apps/frontend/app/(authenticated)/league/[id]/components/bidFitForecast.ts',
)
const { resolveBidWinners } = loadModule('supabase/functions/_shared/bid-resolution.ts')

test('two bids naming the same drop target on a full roster: only the higher priority lands', () => {
  assert.deepEqual(forecast(['h1', 'h1'], 0), [true, false])
})

test('distinct drop targets each bring their own room on a full roster', () => {
  assert.deepEqual(forecast([null, 'h1', 'h2', null], 0), [false, true, true, false])
})

test('a free slot is spent before a conditional drop, as processing does', () => {
  // The drop carrier takes the open slot and keeps its holding, so the plain
  // bid ranked behind it has nowhere to go.
  assert.deepEqual(forecast(['h1', null], 1), [true, false])
})

test('once slots run out, a drop carrier still lands below plain bids that do not', () => {
  assert.deepEqual(forecast([null, null, 'h1'], 1), [true, false, true])
})

test('plain bids fill free slots in priority order', () => {
  assert.deepEqual(forecast([null, null, null, null], 2), [true, true, false, false])
})

test('the forecast matches the resolver for every small single-team week', () => {
  // Every priority-ordered list of up to four uncontested bids, each with no
  // drop or one of two drop targets. Budget and drop allowance are ample: the
  // forecast leaves those to the server, so only slots and targets are compared.
  let lists = [[]]
  for (let length = 1; length <= 4; length++) {
    lists = lists.flatMap((list) => [null, 'h1', 'h2'].map((target) => [...list, target]))

    for (const targets of lists) {
      for (const freeSlots of [0, 1, 2]) {
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
        const capacity = {
          freeSlots,
          remainingBudget: Number.MAX_SAFE_INTEGER,
          remainingDrops: targets.length,
          droppableHoldingIds: new Set(['h1', 'h2']),
        }

        const { winners } = resolveBidWinners(contests, new Map([['team', capacity]]))
        assert.deepEqual(
          forecast(targets, freeSlots),
          contests.map((contest) => winners.has(contest.key)),
          `freeSlots=${freeSlots} targets=${JSON.stringify(targets)}`,
        )
      }
    }
  }
})
