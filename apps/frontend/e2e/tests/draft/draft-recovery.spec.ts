import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openDraft, startDraft, searchDraft, pickMovie, readDraftPicks } from '../../fixtures/draft.fixture'

async function simulateVisibility(page: Page, visibility: 'hidden' | 'visible') {
  // This exercises the app and SDK visibility callbacks, not OS tab suspension.
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    if (state === 'visible') window.dispatchEvent(new Event('focus'))
  }, visibility)
}

async function readSessionCookies(context: BrowserContext) {
  const cookies = (await context.cookies()).filter(cookie => /-auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const encoded = cookies.map(cookie => cookie.value).join('')
  if (!cookies.length || !encoded.startsWith('base64-')) throw new Error('Expected a real Supabase SSR session cookie')
  const session = JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString('utf8'))
  if (!session.access_token || !session.refresh_token) throw new Error('SSR session is missing its Auth credentials')
  return { cookies, session }
}

async function expireClientHint(context: BrowserContext) {
  const { cookies, session } = await readSessionCookies(context)
  // Keep the genuine access/refresh tokens. Only the client expiry hint changes;
  // the installed browser SDK must obtain replacement tokens from real Auth.
  session.expires_at = Math.floor(Date.now() / 1000) + 5
  session.expires_in = 5
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  const chunks = encoded.match(/.{1,3000}/g)!
  const base = cookies[0].name.replace(/\.\d+$/, '')
  for (const cookie of cookies) await context.clearCookies({ name: cookie.name })
  await context.addCookies(chunks.map((value, index) => ({
    ...cookies[0], value, name: chunks.length === 1 ? base : `${base}.${index}`,
  })))
  return session.access_token as string
}

test.describe('draft connection recovery', () => {
  test.use({ draftSlots: 2 })

  test('recovers missed picks after disconnect and synthetic background/resume, then receives a pick after real token refresh @critical @realtime', async ({
    leagueOwnerPage: observer, leagueOwnerContext: observerContext,
    authedPage: second, secondUserPage: third, readyDraft,
  }, testInfo) => {
    test.setTimeout(120_000)
    const pickTimings: Array<{ label: string; status: number; elapsed_ms: number; request_id: string | null }> = []
    async function measuredPick(page: Page, movie: typeof readyDraft.movies[number], label: string) {
      const [response] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST' &&
          response.url().endsWith('/functions/v1/draft-pick')),
        pickMovie(page, movie),
      ])
      await response.finished()
      pickTimings.push({ label, status: response.status(),
        elapsed_ms: Math.round(response.request().timing().responseEnd),
        request_id: response.headers()['x-request-id'] ?? null })
      expect(response.status()).toBe(201)
    }
    await observer.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      const sockets: WebSocket[] = []
      Object.assign(window, { __draftRecoverySockets: sockets })
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          if (String(url).includes('/realtime/')) sockets.push(this)
        }
      }
    })
    let closedSockets = 0
    // Tokens remain in memory only. Assertions expose just whether the newly
    // issued token reached this draft channel, never the token or raw frame.
    let previousAccessToken: string | undefined
    let refreshedAccessToken: string | undefined
    let sentDraftAccessToken: string | undefined
    const deliveredPickIds = new Set<string>()
    const pageErrors: string[] = []
    observer.on('pageerror', error => pageErrors.push(error.message))
    observer.on('websocket', socket => {
      if (!socket.url().includes('/realtime/')) return
      socket.on('close', () => { closedSockets += 1 })
      socket.on('framesent', frame => {
        try {
          const message = JSON.parse(frame.payload.toString())
          const topic = Array.isArray(message) ? message[2] : message.topic
          const event = Array.isArray(message) ? message[3] : message.event
          const payload = Array.isArray(message) ? message[4] : message.payload
          if (previousAccessToken && typeof topic === 'string' && topic.startsWith(`realtime:draft-${readyDraft.id}-`) &&
            (event === 'access_token' || event === 'phx_join') && typeof payload?.access_token === 'string') {
            sentDraftAccessToken = payload.access_token
          }
        } catch { /* Never retain or report raw protocol frames. */ }
      })
      socket.on('framereceived', frame => {
        try {
          const message = JSON.parse(frame.payload.toString())
          const event = Array.isArray(message) ? message[3] : message.event
          const payload = Array.isArray(message) ? message[4] : message.payload
          if (event === 'postgres_changes' && payload?.data?.table === 'draft_picks' &&
            payload.data.record?.league_id === readyDraft.id) deliveredPickIds.add(payload.data.record.id)
        } catch { /* Ignore non-JSON protocol frames; never retain raw frames or tokens. */ }
      })
    })

    await startDraft(observer, readyDraft)
    for (const page of [second, third]) {
      await openDraft(page, readyDraft)
      await expect(page.getByTestId('draft-connection-status')).toHaveText('Live')
    }
    await searchDraft(observer, readyDraft)
    await measuredPick(observer, readyDraft.movies[0], 'first pick in recovery case')
    await expect(observer.getByTestId('draft-progress')).toContainText('1/6')
    const originalUrl = observer.url()
    let navigations = 0
    observer.on('framenavigated', frame => { if (frame === observer.mainFrame()) navigations += 1 })

    try {
      await simulateVisibility(observer, 'hidden')
      await observerContext.setOffline(true)
      const closedBefore = closedSockets
      const socketsClosed = await observer.evaluate(() => {
        const sockets = (window as unknown as { __draftRecoverySockets: WebSocket[] }).__draftRecoverySockets
          .filter(socket => socket.readyState === WebSocket.OPEN)
        sockets.forEach(socket => socket.close(1000, 'Draft recovery test disconnect'))
        return sockets.length
      })
      expect(socketsClosed).toBeGreaterThan(0)
      await expect.poll(() => closedSockets).toBeGreaterThan(closedBefore)
      await expect(observer.getByTestId('draft-connection-status')).not.toHaveText('Live')

      for (const [index, page] of [second, third].entries()) {
        await expect(page.getByText("It's your turn!", { exact: true })).toBeVisible()
        await searchDraft(page, readyDraft)
        await pickMovie(page, readyDraft.movies[index + 1])
      }
      const missedPicks = await readDraftPicks(readyDraft.id)
      expect(missedPicks).toHaveLength(3)
      expect(deliveredPickIds.has(missedPicks[1].id)).toBe(false)
      expect(deliveredPickIds.has(missedPicks[2].id)).toBe(false)
      await expect(observer.getByTestId('draft-progress')).toContainText('1/6')
      const history = observer.getByTestId('draft-history')
      await expect(history).not.toContainText(readyDraft.movies[1].title)
      await expect(history).not.toContainText(readyDraft.movies[2].title)

      await observerContext.setOffline(false)
      await simulateVisibility(observer, 'visible')
      // Recovery events must reconcile the missed rows without a page reload.
      await expect(observer.getByTestId('draft-progress')).toContainText('3/6', { timeout: 7000 })
      await expect(history).toContainText(readyDraft.movies[1].title)
      await expect(history).toContainText(readyDraft.movies[2].title)
      await expect(observer.getByTestId('draft-connection-status')).toHaveText('Live', { timeout: 20_000 })

      await simulateVisibility(observer, 'hidden')
      previousAccessToken = await expireClientHint(observerContext)
      const refreshResponse = observer.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token'
      })
      await simulateVisibility(observer, 'visible')
      const refreshed = await refreshResponse
      expect(refreshed.status()).toBe(200)
      await refreshed.finished()
      refreshedAccessToken = (await refreshed.json()).access_token
      await expect.poll(() => typeof refreshedAccessToken === 'string' &&
        refreshedAccessToken !== previousAccessToken && sentDraftAccessToken === refreshedAccessToken).toBe(true)
      await expect.poll(async () => {
        const { session } = await readSessionCookies(observerContext)
        return session.expires_at > Math.floor(Date.now() / 1000) + 300
      }).toBe(true)
      await expect(observer.getByTestId('draft-connection-status')).toHaveText('Live')

      // The other player still owns the consecutive turn. A matching socket
      // frame proves that the refreshed observer is receiving live mutations.
      await expect(third.getByText("It's your turn!", { exact: true })).toBeVisible()
      await measuredPick(third, readyDraft.movies[3], 'warm pick after observer token refresh')
      const picks = await readDraftPicks(readyDraft.id)
      expect(picks).toHaveLength(4)
      expect(picks[3]).toMatchObject({ round: 2, pick_number: 1, team_id: readyDraft.teamIds[2] })
      await expect.poll(() => deliveredPickIds.has(picks[3].id), { timeout: 7000 }).toBe(true)
      await expect(observer.getByTestId('draft-progress')).toContainText('4/6', { timeout: 7000 })
      await expect(history).toContainText(readyDraft.movies[3].title)
      await expect(observer.getByTestId('draft-connection-status')).toHaveText('Live')
      expect(observer.url()).toBe(originalUrl)
      expect(navigations).toBe(0)
      expect(pageErrors).toEqual([])
    } finally {
      previousAccessToken = undefined
      refreshedAccessToken = undefined
      sentDraftAccessToken = undefined
      await testInfo.attach('draft-pick-latency', {
        body: JSON.stringify(pickTimings), contentType: 'application/json',
      })
      await observerContext.setOffline(false)
      await simulateVisibility(observer, 'visible')
    }
  })
})
