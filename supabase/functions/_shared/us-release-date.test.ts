import { assertEquals } from '@std/assert'
import { usReleaseDate, type TMDbReleaseDates } from './us-release-date.ts'

function releases(byCountry: Record<string, Array<[type: number, date: string]>>): TMDbReleaseDates {
  return {
    results: Object.entries(byCountry).map(([iso_3166_1, dates]) => ({
      iso_3166_1,
      release_dates: dates.map(([type, date]) => ({ type, release_date: `${date}T00:00:00.000Z`, certification: '' })),
    })),
  }
}

Deno.test('usReleaseDate', async (t) => {
  await t.step('uses the US wide date over an earlier opening abroad', () => {
    // The Cat in the Hat (2026): Philippines on Wednesday, US that Friday.
    const dates = releases({ PH: [[3, '2026-11-04']], US: [[1, '2026-10-25'], [3, '2026-11-06']] })
    assertEquals(usReleaseDate(dates, '2026-11-04'), '2026-11-06')
  })

  await t.step('ignores a limited early screening days before the wide release', () => {
    // An IMAX early-access Tuesday is not when the movie came out.
    const dates = releases({ US: [[2, '2026-11-03'], [3, '2026-11-06']] })
    assertEquals(usReleaseDate(dates, '2026-11-03'), '2026-11-06')
  })

  await t.step('ignores a limited release after the wide one', () => {
    const dates = releases({ US: [[2, '2026-08-06'], [3, '2026-07-31']] })
    assertEquals(usReleaseDate(dates, '2026-07-29'), '2026-07-31')
  })

  await t.step('uses a platform release that opens limited a week or more before going wide', () => {
    const dates = releases({ US: [[1, '2026-01-23'], [2, '2026-11-20'], [3, '2026-12-04']] })
    assertEquals(usReleaseDate(dates, '2026-11-19'), '2026-11-20')
  })

  await t.step('uses a limited-only release', () => {
    const dates = releases({ US: [[2, '2026-03-06'], [4, '2026-03-20']] })
    assertEquals(usReleaseDate(dates, '2026-03-05'), '2026-03-06')
  })

  await t.step('uses the US digital premiere when there is no US theatrical run', () => {
    const dates = releases({ GB: [[3, '2026-01-20']], US: [[1, '2026-01-10'], [4, '2026-01-28']] })
    assertEquals(usReleaseDate(dates, '2026-01-20'), '2026-01-28')
  })

  await t.step('falls back to the primary date when TMDb lists no US release', () => {
    assertEquals(usReleaseDate(releases({ JP: [[3, '2026-12-11']] }), '2026-12-11'), '2026-12-11')
    assertEquals(usReleaseDate(releases({ US: [[1, '2026-09-01']] }), '2026-12-11'), '2026-12-11')
    assertEquals(usReleaseDate(undefined, '2026-12-11'), '2026-12-11')
    assertEquals(usReleaseDate(undefined, ''), null)
    assertEquals(usReleaseDate(undefined, null), null)
  })

  await t.step('takes the earliest of several US dates of a type', () => {
    const dates = releases({ US: [[3, '2026-07-10'], [3, '2026-07-03']] })
    assertEquals(usReleaseDate(dates, '2026-07-01'), '2026-07-03')
  })
})
