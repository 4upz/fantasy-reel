import { assertEquals } from '@std/assert'

// Exercise the actual handlers with only HTTP replaced. No database or TMDb
// account is needed, and unexpected outbound requests fail the test.
Deno.test('discovery handlers preserve upstream pages and eligible overflow', async (t) => {
  type Handler = (request: Request) => Promise<Response>
  const saved = new Map(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TMDB_API_KEY', 'SENTRY_DSN']
    .map(key => [key, Deno.env.get(key)]))
  Deno.env.set('SUPABASE_URL', 'http://discovery-cache.invalid')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'discovery-test-service')
  Deno.env.set('TMDB_API_KEY', 'discovery-test-tmdb')
  Deno.env.delete('SENTRY_DSN')
  let handler: Handler
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const originalInterval = globalThis.setInterval
  const intervals: number[] = []
  // The existing service cache client starts SDK refresh bookkeeping. Clean
  // those timers at teardown without changing the production client here.
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = originalInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval
  Deno.serve = ((callback: Handler) => { handler = callback }) as typeof Deno.serve
  const requests: URL[] = []
  let upstreamResults: Array<Record<string, unknown>> = []
  globalThis.fetch = (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === 'discovery-cache.invalid') {
      return Promise.resolve(Response.json(init?.method === 'POST' ? {} : null))
    }
    if (url.hostname !== 'api.themoviedb.org') throw new Error(`Unexpected outbound host: ${url.hostname}`)
    requests.push(url)
    return Promise.resolve(Response.json({ page: Number(url.searchParams.get('page')), total_pages: 8,
      total_results: 153, results: upstreamResults }))
  }
  const movie = (id: number, release_date = '2999-12-20') => ({ id, title: `Discovery ${id}`,
    release_date, overview: null, poster_path: null, backdrop_path: null, vote_average: 8.7,
    vote_count: 100, popularity: 1, genre_ids: [], adult: false })
  const invoke = async (body: unknown) => {
    const response = await handler(new Request('http://local.test', { method: 'POST',
      headers: { Authorization: 'Bearer discovery-test-service', 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }))
    return { status: response.status, data: await response.json() }
  }
  try {
    await import('../browse-movies/index.ts')
    await t.step('Trending page 2 fetches only page 2 and retains all 25 eligible results', async () => {
      upstreamResults = Array.from({ length: 25 }, (_, i) => movie(i + 1))
      const { status, data } = await invoke({ trending: true, page: 2, season_year: 2026 })
      assertEquals(status, 200)
      assertEquals(requests.map(url => [url.pathname, url.searchParams.get('page')]), [['/3/trending/movie/week', '2']])
      assertEquals(data.results.length, 25)
      assertEquals(data.page, 2)
      assertEquals(data.has_more, true)
      assertEquals(data.total_results, 153)
      assertEquals(data.total_results_scope, 'upstream')
    })
    await t.step('An empty eligible Trending page still exposes its next page', async () => {
      upstreamResults = [movie(30, '2000-01-01')]
      const { data } = await invoke({ trending: true, page: 3 })
      assertEquals(data.results, [])
      assertEquals(data.page, 3)
      assertEquals(data.has_more, true)
      assertEquals(data.total_results, 153)
    })
    await t.step('Browse sends release and genre controls upstream', async () => {
      upstreamResults = [movie(40)]
      assertEquals((await invoke({ page: 2, release_window: 'next30', genres: [28, 12] })).status, 200)
      const url = requests.at(-1)!
      assertEquals(url.pathname, '/3/discover/movie')
      assertEquals(url.searchParams.get('page'), '2')
      assertEquals(url.searchParams.get('with_genres'), '28,12')
      const gte = url.searchParams.get('primary_release_date.gte')!
      const lte = url.searchParams.get('primary_release_date.lte')!
      assertEquals((Date.parse(lte) - Date.parse(gte)) / 86_400_000, 30)
    })
    await t.step('Invalid browse page and body are rejected before upstream HTTP', async () => {
      const before = requests.length
      for (const body of [{ page: 0 }, { page: 501 }, { trending: true, page: 1001 }, null]) {
        assertEquals((await invoke(body)).status, 400)
      }
      assertEquals(requests.length, before)
    })
    await import('../search-movies/index.ts')
    await t.step('Search keeps upstream totals when its eligible page is empty', async () => {
      upstreamResults = [movie(50, '2000-01-01')]
      const { status, data } = await invoke({ query: 'Discovery', page: 2, upcoming_only: true })
      assertEquals(status, 200)
      assertEquals(data.results, [])
      assertEquals(data.page, 2)
      assertEquals(data.total_pages, 8)
      assertEquals(data.total_results, 153)
      assertEquals(data.has_more, true)
      assertEquals(requests.at(-1)!.searchParams.get('page'), '2')
    })
    await t.step('Search page limit and malformed query never reach TMDb', async () => {
      const before = requests.length
      for (const body of [{ query: 'Discovery', page: 501 }, { query: 123 }, null]) {
        assertEquals((await invoke(body)).status, 400)
      }
      assertEquals(requests.length, before)
    })
  } finally {
    globalThis.fetch = originalFetch
    Deno.serve = originalServe
    globalThis.setInterval = originalInterval
    intervals.forEach(clearInterval)
    for (const [key, value] of saved) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
})
