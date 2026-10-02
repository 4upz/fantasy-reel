import { describe, it, expect } from 'vitest'
import { formatRosterPoints, hasReleased } from './points.js'

const now = new Date('2026-10-02T12:00:00Z')

describe('hasReleased', () => {
  it('counts a movie released today or earlier on the UTC calendar', () => {
    expect(hasReleased('2026-10-02', now)).toBe(true)
    expect(hasReleased('2026-09-01', now)).toBe(true)
  })

  it('does not count a movie releasing tomorrow', () => {
    expect(hasReleased('2026-10-03', now)).toBe(false)
  })

  it('treats missing and malformed dates as unreleased', () => {
    for (const date of [null, undefined, '', 'TBD', '2026-10-02T00:00:00Z']) {
      expect(hasReleased(date, now)).toBe(false)
    }
  })

  it('goes by the UTC date, not the local one', () => {
    // 11:30pm on Oct 9 in Los Angeles is already Oct 10 in UTC.
    const lateEvening = new Date('2026-10-09T23:30:00-07:00')
    expect(hasReleased('2026-10-10', lateEvening)).toBe(true)
    expect(hasReleased('2026-10-11', lateEvening)).toBe(false)
  })
})

describe('formatRosterPoints', () => {
  it('shows counted points plainly', () => {
    expect(formatRosterPoints(24, '2026-09-01', now)).toBe('24 pts')
  })

  it('marks a pre-release score as not counted yet', () => {
    expect(formatRosterPoints(24, '2026-12-18', now)).toBe('24 pts at release')
    expect(formatRosterPoints(-16.25, null, now)).toBe('-16.25 pts at release')
  })

  it('keeps "Unreleased" for a movie with no score', () => {
    expect(formatRosterPoints(null, '2026-12-18', now)).toBe('Unreleased')
  })
})
