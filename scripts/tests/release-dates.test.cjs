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
const { formatReleaseDateFull, formatReleaseDateShort, getReleaseYear, hasReleased, isWithinDays } = exported

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

test('a movie has released from its UTC release day, when its points start to count', () => {
  const midnight = new Date('2026-10-10T00:00:00Z')
  assert.equal(hasReleased('2026-10-10', midnight), true)
  assert.equal(hasReleased('2026-10-09', midnight), true)
  assert.equal(hasReleased('2026-10-11', midnight), false)

  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone
      // Still Oct 9 in Los Angeles, but already Oct 10 in UTC...
      const lateEvening = new Date('2026-10-09T23:30:00-07:00')
      assert.equal(hasReleased('2026-10-10', lateEvening), true, timezone)
      assert.equal(hasReleased('2026-10-11', lateEvening), false, timezone)
      // ...and already Oct 11 in Kiritimati, but still Oct 10 in UTC.
      const kiritimatiMorning = new Date('2026-10-11T10:00:00+14:00')
      assert.equal(hasReleased('2026-10-10', kiritimatiMorning), true, timezone)
      assert.equal(hasReleased('2026-10-11', kiritimatiMorning), false, timezone)
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('missing and invalid release dates remain unknown', () => {
  for (const date of [null, '', 'invalid', '2026-02-30', '2026-01-01T00:00:00Z']) {
    assert.equal(formatReleaseDateFull(date), 'TBA')
    assert.equal(getReleaseYear(date), null)
    assert.equal(isWithinDays(date, 30), false)
    assert.equal(hasReleased(date), false)
  }
  assert.equal(hasReleased(undefined), false)
  assert.equal(formatReleaseDateFull('2028-02-29'), 'February 29, 2028')
})
