const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

// The bid priority list's cut line must agree with process-bids about which
// bids land, so exercise the real forecast rather than a copy of it.
const source = readFileSync(
  resolve(__dirname, '../../apps/frontend/app/(authenticated)/league/[id]/components/bidFitForecast.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported })
// Spread into this realm: deepStrictEqual compares prototypes, and arrays built
// inside the vm context carry that context's Array.prototype.
const forecast = (dropTargets, freeSlots) => [...exported.forecastBidFits(dropTargets, freeSlots)]

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
