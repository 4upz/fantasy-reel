const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Script } = require('node:vm')
const ts = require('typescript')

// Exercise the actual frontend utility without adding a second browser/test framework.
const source = readFileSync(resolve(__dirname, '../../apps/frontend/utils/date.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
new Script(compiled).runInNewContext({ exports: exported, Date, Intl })
const { formatReleaseDateFull, formatReleaseDateShort, getReleaseYear, isWithinDays } = exported

test('release calendar days and years survive western and eastern time zones', () => {
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/New_York', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone
      assert.equal(formatReleaseDateFull('2027-01-01'), 'January 1, 2027', timezone)
      assert.equal(formatReleaseDateShort('2026-12-20'), 'Dec 20', timezone)
      assert.equal(getReleaseYear('2027-01-01'), 2027, timezone)
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('release windows include today and cross the year boundary using server UTC policy', () => {
  const now = new Date('2026-12-20T23:59:00Z')
  assert.equal(isWithinDays('2026-12-20', 30, now), true)
  assert.equal(isWithinDays('2027-01-19', 30, now), true)
  assert.equal(isWithinDays('2027-01-20', 30, now), false)
  assert.equal(isWithinDays('2026-12-19', 30, now), false)
})

test('missing and invalid release dates remain unknown', () => {
  for (const date of [null, '', 'invalid', '2026-02-30', '2026-01-01T00:00:00Z']) {
    assert.equal(formatReleaseDateFull(date), 'TBA')
    assert.equal(getReleaseYear(date), null)
    assert.equal(isWithinDays(date, 30), false)
  }
  assert.equal(formatReleaseDateFull('2028-02-29'), 'February 29, 2028')
})
