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
const { describePreReleaseScore, formatPointsText, isPreReleaseScore, pointsTone } = loadModule('utils/scoring.ts', {
  '@/utils/date': date,
})
const { getMovieStatus } = loadModule('utils/league.ts', { '@/utils/date': date })

// The release rule itself (UTC days, bad dates) is covered in release-dates.test.cjs.
const now = new Date('2026-10-10T12:00:00Z')

test('a score counts from its release day and is pre-release before it', () => {
  assert.equal(isPreReleaseScore(24, '2026-10-10', now), false)
  assert.equal(isPreReleaseScore(24, '2026-10-11', now), true)
})

test('zero and negative scores are scores too; no score is never pre-release', () => {
  assert.equal(isPreReleaseScore(0, '2026-10-11', now), true)
  // A counterpick's inverted points follow the targeted movie's release date.
  assert.equal(isPreReleaseScore(-24, '2026-10-11', now), true)
  assert.equal(isPreReleaseScore(null, '2026-10-11', now), false)
  assert.equal(isPreReleaseScore(undefined, null, now), false)
})

test('pre-release points read as not counted yet', () => {
  assert.equal(formatPointsText(24, false), '24 pts')
  assert.equal(formatPointsText(-16.25, true), '-16 pts at release')
  assert.equal(describePreReleaseScore('2026-10-10'), 'Pre-release score — counts once it releases on Oct 10')
  assert.equal(describePreReleaseScore(null), 'Pre-release score — counts once it releases')
})

test('only counted points take the colours that mean counted', () => {
  assert.equal(pointsTone(24), 'text-success')
  assert.equal(pointsTone(-16, { positive: 'text-gold' }), 'text-crimson')
  assert.equal(pointsTone(24, { positive: 'text-gold' }), 'text-gold')
  assert.equal(pointsTone(24, { preRelease: true }), 'text-foreground-secondary')
  assert.equal(pointsTone(null), 'text-foreground-secondary')
})

test('the dashboard only calls a released movie scored', () => {
  const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  assert.equal(getMovieStatus('2020-06-01', 84), 'scored')
  assert.equal(getMovieStatus(inFiveDays, 84), 'releasing_soon')
  assert.equal(getMovieStatus('2099-06-01', 84), 'upcoming')
  assert.equal(getMovieStatus(null, 84), 'upcoming')
})
