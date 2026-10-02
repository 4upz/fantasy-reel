const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

/** Transpile a frontend module, resolving its imports from `modules`. */
function loadModule(relativePath, modules = {}) {
  const source = readFileSync(resolve(__dirname, '../../apps/frontend', relativePath), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exported = {}
  const require = (name) => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`)
    return modules[name]
  }
  new Script(compiled).runInNewContext({ exports: exported, require, Date, Intl })
  return exported
}

// The real helpers every points display goes through, wired to the real date module.
const date = loadModule('utils/date.ts')
const { describePreReleaseScore, formatPointsText, isPreReleaseScore } = loadModule('utils/scoring.ts', {
  '@/utils/date': date,
})
const { getMovieStatus } = loadModule('utils/league.ts', { '@/utils/date': date })

// Still Oct 9 in Los Angeles, but already Oct 10 in UTC.
const now = new Date('2026-10-09T23:30:00-07:00')

test('a score counts from its UTC release day and is pre-release before it', () => {
  assert.equal(isPreReleaseScore(24, '2026-10-10', now), false)
  assert.equal(isPreReleaseScore(24, '2026-10-09', now), false)
  assert.equal(isPreReleaseScore(24, '2026-10-11', now), true)
})

test('zero and negative scores are scores too; no score is never pre-release', () => {
  assert.equal(isPreReleaseScore(0, '2026-10-11', now), true)
  // A counterpick's inverted points follow the targeted movie's release date.
  assert.equal(isPreReleaseScore(-24, '2026-10-11', now), true)
  assert.equal(isPreReleaseScore(null, '2026-10-11', now), false)
  assert.equal(isPreReleaseScore(undefined, null, now), false)
})

test('a scored movie without a usable release date has not released', () => {
  for (const releaseDate of [null, undefined, '', 'invalid', '2026-02-30', '2026-10-01T00:00:00Z']) {
    assert.equal(isPreReleaseScore(24, releaseDate, now), true, String(releaseDate))
  }
})

test('pre-release points read as not counted yet', () => {
  assert.equal(formatPointsText(24, false), '24 pts')
  assert.equal(formatPointsText(-16.25, true), '-16 pts at release')
  assert.equal(describePreReleaseScore('2026-10-10'), 'Pre-release score — counts once it releases on Oct 10')
  assert.equal(describePreReleaseScore(null), 'Pre-release score — counts once it releases')
})

test('the dashboard only calls a released movie scored', () => {
  const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  assert.equal(getMovieStatus('2020-06-01', 84), 'scored')
  assert.equal(getMovieStatus(inFiveDays, 84), 'releasing_soon')
  assert.equal(getMovieStatus('2099-06-01', 84), 'upcoming')
  assert.equal(getMovieStatus(null, 84), 'upcoming')
})
