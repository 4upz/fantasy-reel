import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, beforeEach, test } from 'node:test'
import ts from 'typescript'

// Exercise the actual TypeScript helper without introducing another test runtime.
const source = readFileSync(new URL('../apps/frontend/e2e/helpers/test-ids.helper.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const ids = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const previousRunId = process.env.E2E_RUN_ID
const runA = '01234567-89ab-4cde-8fab-0123456789ab'
const runB = '01234567-89ab-4cde-8fab-0123456789ac'

beforeEach(() => {
  process.env.E2E_RUN_ID = runA
  ids.setWorkerIndex(0, 'test-a:0')
})
after(() => {
  if (previousRunId === undefined) delete process.env.E2E_RUN_ID
  else process.env.E2E_RUN_ID = previousRunId
})

test('cleanup rejects manual users, other runs, and lookalike domains', () => {
  const ownEmail = ids.uniqueEmail('owner')
  assert.equal(ids.isRunEmail(ownEmail), true)
  assert.equal(ids.isRunEmail('alice@fantasyreel.test'), false)
  assert.equal(ids.isRunEmail('manual@test.local'), false)
  assert.equal(ids.isRunEmail(`${ownEmail}.example.com`), false)
  assert.equal(ids.isRunEmail(undefined), false)
  process.env.E2E_RUN_ID = runB
  assert.equal(ids.isRunEmail(ownEmail), false)
})

test('worker cleanup does not confuse worker 1 with worker 10', () => {
  ids.setWorkerIndex(1)
  const workerOne = ids.uniqueEmail('primary')
  ids.setWorkerIndex(10)
  const workerTen = ids.uniqueEmail('primary')
  assert.equal(ids.isRunEmail(workerOne, 1), true)
  assert.equal(ids.isRunEmail(workerTen, 1), false)
  assert.equal(ids.isRunEmail(workerOne, 10), false)
  assert.equal(ids.isRunEmail(workerTen), true)
})

test('cleanup requires a worker number after the exact run identifier', () => {
  process.env.E2E_RUN_ID = 'abcdefgh-wrong'
  const otherRunEmail = ids.uniqueEmail('owner')
  process.env.E2E_RUN_ID = 'abcdefgh'
  assert.equal(ids.isRunEmail(otherRunEmail), false)
})

test('invalid or absent run IDs fail closed before a cleanup pattern can be built', () => {
  for (const value of ['', 'short', 'wildcard_%', "quoted'run-id", 'UPPERCASE']) {
    process.env.E2E_RUN_ID = value
    assert.throws(() => ids.movieRunMarker(), /E2E_RUN_ID/)
    assert.throws(() => ids.isRunEmail('manual@test.local'), /E2E_RUN_ID/)
  }
  delete process.env.E2E_RUN_ID
  assert.throws(() => ids.getRunId(), /E2E_RUN_ID/)
})

test('movie IDs differ across runs, workers, tests and retries and fit PostgreSQL integer', () => {
  const values = new Set()
  for (const run of [runA, runB]) {
    process.env.E2E_RUN_ID = run
    for (const worker of [0, 1]) {
      for (const scope of ['test-a:0', 'test-a:1', 'test-b:0']) {
        ids.setWorkerIndex(worker, scope)
        for (let localId = 0; localId < 100; localId++) {
          const id = ids.uniqueTmdbId(localId)
          assert.ok(Number.isInteger(id) && id > 0 && id <= 2_147_483_647)
          assert.equal(values.has(id), false)
          values.add(id)
        }
      }
    }
  }
  assert.equal(values.size, 1200)
})

test('shared mock IDs agree between setup and workers but change across runs', () => {
  const setupId = ids.uniqueTmdbId(9000, true)
  ids.setWorkerIndex(17, 'other-test:2')
  assert.equal(ids.uniqueTmdbId(9000, true), setupId)
  process.env.E2E_RUN_ID = runB
  assert.notEqual(ids.uniqueTmdbId(9000, true), setupId)
})

test('movie IDs reject invalid local indices', () => {
  for (const value of [-1, 10000, 0.5, NaN, Infinity]) {
    assert.throws(() => ids.uniqueTmdbId(value), /localId/)
  }
})
