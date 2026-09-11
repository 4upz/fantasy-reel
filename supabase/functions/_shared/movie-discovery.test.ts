import { assertEquals } from '@std/assert'
import { discoveryPage, releaseDateRange } from './movie-discovery.ts'

Deno.test('next 30 days crosses a year boundary and uses the UTC calendar date', () => {
  assertEquals(releaseDateRange('next30', new Date('2026-12-20T23:59:00-05:00')), {
    gte: '2026-12-21', lte: '2027-01-20',
  })
  assertEquals(releaseDateRange('quarter', new Date('2026-12-20T00:00:00Z')), {
    gte: '2026-12-20', lte: '2027-03-20',
  })
  assertEquals(releaseDateRange('all', new Date('2026-09-11T00:00:00Z')).lte, '2028-12-31')
})

Deno.test('filtered empty upstream pages preserve the next page and truthful totals', () => {
  const page = discoveryPage({ page: 2, total_pages: 9, total_results: 179 }, [])
  assertEquals(page.page, 2)
  assertEquals(page.has_more, true)
  assertEquals(page.total_results, 179)
  assertEquals(page.total_results_scope, 'upstream')
})

Deno.test('page boundaries never discard overflow and stop at the endpoint page limit', () => {
  const movies = Array.from({ length: 25 }, (_, index) => ({ id: index }))
  assertEquals(discoveryPage({ page: 2, total_pages: 2, total_results: 45 }, movies, 1000).results, movies)
  assertEquals(discoveryPage({ page: 500, total_pages: 800, total_results: 16000 }, []).has_more, false)
  assertEquals(discoveryPage({ page: 500, total_pages: 800, total_results: 16000 }, [], 1000).has_more, true)
})
