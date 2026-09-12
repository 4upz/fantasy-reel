import { assertEquals } from '@std/assert'

type Handler = (request: Request) => Promise<Response>
type Kind = 'draft' | 'counterpick'
const leagueId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const otherUserId = '10000000-0000-4000-8000-000000000003'
const movieId = '10000000-0000-4000-8000-000000000004'
const requestId = '10000000-0000-4000-8000-000000000005'
const resultId = '10000000-0000-4000-8000-000000000006'
const tmdbId = 1900000001

function receipt(kind: Kind) {
  return { league_id: leagueId, user_id: userId, movie_id: movieId, kind,
    expected_pick: 1, result_id: resultId, movies: { tmdb_id: tmdbId } }
}

// Load the real handlers and SDK. Only transport is replaced so the first
// receipt read can miss a concurrent commit deterministically, without a DB.
Deno.test('draft submission handlers reconcile commits before preflight rejection', async (t) => {
  const saved = new Map(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TMDB_API_KEY', 'SENTRY_DSN']
    .map(key => [key, Deno.env.get(key)]))
  Deno.env.set('SUPABASE_URL', 'http://draft-handler.invalid')
  Deno.env.set('SUPABASE_ANON_KEY', 'inert-anon-key')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'inert-service-key')
  Deno.env.set('TMDB_API_KEY', 'inert-provider-key')
  Deno.env.delete('SENTRY_DSN')
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const originalInterval = globalThis.setInterval
  const intervals: number[] = []
  const handlers: Handler[] = []
  Deno.serve = ((handler: Handler) => { handlers.push(handler) }) as typeof Deno.serve
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = originalInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval

  async function invoke(kind: Kind, options: {
    phase?: string; nextUser?: string | null; count?: number;
    receipts?: Array<ReturnType<typeof receipt> | null>; auth?: boolean;
    expectedPick?: number | null;
  } = {}) {
    const calls: string[] = []
    let reads = 0
    let commits = 0
    const unexpected: string[] = []
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const path = url.pathname
      calls.push(path)
      if (url.hostname === 'draft-handler.invalid') {
        if (path === '/auth/v1/user') return Promise.resolve(Response.json({ id: userId }))
        if (path === '/rest/v1/draft_submissions') {
          assertEquals(url.searchParams.get('request_id'), `eq.${requestId}`)
          const data = options.receipts?.[reads] ?? null
          reads += 1
          return Promise.resolve(Response.json(data))
        }
        if (path === '/rest/v1/leagues') return Promise.resolve(Response.json({
          status: options.phase ?? (kind === 'draft' ? 'drafting' : 'counterpicking'), season_year: 2026,
        }))
        if (path === '/rest/v1/rpc/get_next_draft_pick') return Promise.resolve(Response.json(
          options.nextUser === null ? [] : [{ user_id: options.nextUser ?? otherUserId }],
        ))
        if (path === '/rest/v1/draft_picks') {
          assertEquals(init?.method, 'HEAD')
          return Promise.resolve(new Response(null, { headers: { 'Content-Range': `0-0/${options.count ?? 1}` } }))
        }
        if (path === `/rest/v1/rpc/commit_${kind === 'draft' ? 'draft_pick' : 'counterpick'}`) {
          commits += 1
          assertEquals(JSON.parse(String(init?.body)), {
            p_league_id: leagueId, p_user_id: userId, p_movie_id: movieId,
            p_expected_pick: 1, p_request_id: requestId,
          })
          return Promise.resolve(Response.json({ [kind === 'draft' ? 'pick' : 'counterpick']: { id: resultId }, replayed: true }))
        }
      }
      // Includes cache reads, movie upserts, and provider requests. A denial or
      // replay must not perform any of them, even if a caught error returns 4xx.
      unexpected.push(path)
      throw new Error('Unexpected request in a denied or replayed submission')
    }
    const body = { league_id: leagueId, request_id: requestId,
      ...(options.expectedPick === null ? {} : { expected_pick: options.expectedPick ?? 1 }),
      ...(kind === 'draft' ? { tmdb_id: tmdbId } : { movie_id: movieId }) }
    const response = await handlers[kind === 'draft' ? 0 : 1](new Request('http://handler.test', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(options.auth === false ? {} : { Authorization: 'Bearer inert-user-token' }) }, body: JSON.stringify(body),
    }))
    const data = await response.json()
    assertEquals(unexpected, [], 'denials and replays must not resolve or write movie metadata')
    return { status: response.status, data, reads, commits, calls }
  }

  try {
    await import('../draft-pick/index.ts')
    await import('../make-counterpick/index.ts')
    assertEquals(handlers.length, 2)
    for (const kind of ['draft', 'counterpick'] as const) {
      await t.step(`${kind}: unauthenticated requests stop before database/provider access`, async () => {
        const result = await invoke(kind, { auth: false })
        assertEquals(result.status, 401)
        assertEquals(result.calls, [])
      })
      await t.step(`${kind}: final-phase change after the initial receipt miss replays the committed result`, async () => {
        const result = await invoke(kind, { phase: 'active', receipts: [null, receipt(kind)] })
        assertEquals(result.status, 201)
        assertEquals(result.data, { [kind === 'draft' ? 'pick' : 'counterpick']: { id: resultId }, replayed: true })
        assertEquals(result.reads, 2)
        assertEquals(result.commits, 1)
        assertEquals(result.calls.slice(-3), ['/rest/v1/leagues', '/rest/v1/draft_submissions',
          `/rest/v1/rpc/commit_${kind === 'draft' ? 'draft_pick' : 'counterpick'}`])
      })
      await t.step(`${kind}: explicit attempts against a closed phase return conflict without metadata`, async () => {
        const result = await invoke(kind, { phase: 'active' })
        assertEquals(result.status, 409)
        assertEquals(result.commits, 0)
      })
      await t.step(`${kind}: legacy phase rejection remains 400`, async () => {
        const result = await invoke(kind, { phase: 'active', expectedPick: null })
        assertEquals(result.status, 400)
        assertEquals(result.commits, 0)
      })
      for (const changed of [{ user_id: otherUserId }, { league_id: otherUserId },
        { expected_pick: 2 }, { kind: kind === 'draft' ? 'counterpick' as const : 'draft' as const },
        // Draft requests identify movies by TMDb ID; counterpicks use row IDs.
        ...(kind === 'draft' ? [{ movies: { tmdb_id: tmdbId + 1 } }] : [{ movie_id: otherUserId }])]) {
        await t.step(`${kind}: a raced receipt with different ${Object.keys(changed)[0]} cannot replay`, async () => {
          const result = await invoke(kind, { phase: 'active', receipts: [null, { ...receipt(kind), ...changed }] })
          assertEquals(result.status, 409)
          assertEquals(result.data.error, 'This request ID was already used for a different selection')
          assertEquals(result.commits, 0)
        })
      }
      await t.step(`${kind}: an existing matching receipt bypasses phase and metadata reads`, async () => {
        const result = await invoke(kind, { receipts: [receipt(kind)] })
        assertEquals(result.status, 201)
        assertEquals(result.data.replayed, true)
        assertEquals(result.reads, 1)
        assertEquals(result.commits, 1)
        assertEquals(result.calls, ['/auth/v1/user', '/rest/v1/draft_submissions',
          `/rest/v1/rpc/commit_${kind === 'draft' ? 'draft_pick' : 'counterpick'}`])
      })
    }
    await t.step('draft: stale slot is 409 even when the next player has changed', async () => {
      const result = await invoke('draft')
      assertEquals(result.status, 409)
      assertEquals(result.data.error, 'The draft has advanced. Review the latest turn.')
      assertEquals(result.commits, 0)
    })
    await t.step('draft: current-slot out-of-turn selection remains 403', async () => {
      const result = await invoke('draft', { count: 0 })
      assertEquals(result.status, 403)
      assertEquals(result.data.error, 'It is not your turn to pick')
      assertEquals(result.commits, 0)
    })
    await t.step('draft: legacy out-of-turn selection remains 403 without a count query', async () => {
      const result = await invoke('draft', { expectedPick: null })
      assertEquals(result.status, 403)
      assertEquals(result.data.error, 'It is not your turn to pick')
      assertEquals(result.commits, 0)
      assertEquals(result.calls.includes('/rest/v1/draft_picks'), false)
    })
    await t.step('draft: receipt is reread after the changed-turn/count snapshot', async () => {
      const result = await invoke('draft', { receipts: [null, receipt('draft')] })
      assertEquals(result.status, 201)
      assertEquals(result.data.pick.id, resultId)
      assertEquals(result.data.replayed, true)
      assertEquals(result.commits, 1)
      assertEquals(result.calls.slice(-3), [
        '/rest/v1/draft_picks', '/rest/v1/draft_submissions', '/rest/v1/rpc/commit_draft_pick',
      ])
    })
    await t.step('draft: an exhausted turn snapshot still replays the final receipt', async () => {
      const result = await invoke('draft', { nextUser: null, receipts: [null, receipt('draft')] })
      assertEquals(result.status, 201)
      assertEquals(result.data.pick.id, resultId)
      assertEquals(result.commits, 1)
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
