import type { Request } from '@playwright/test'
import { randomUUID } from 'crypto'
import { test, expect, openDraft, startDraft, searchDraft, pickMovie, readDraftPicks } from '../../fixtures/draft.fixture'
import { getAdminClient } from '../../helpers/supabase.helper'
import { seedDraftSearch } from '../../helpers/draft-cache.helper'

// Real local Auth, RLS, Edge handlers, and Realtime. Only the external movie
// source is replaced by canonical cache rows, which draft-pick also verifies.
test.describe('Draft flow', () => {
  test('owner starts the configured draft and can search upcoming titles @critical', async ({ leagueOwnerPage: page, readyDraft }) => {
    await startDraft(page, readyDraft)
    await expect(page.getByTestId('draft-progress')).toContainText('0/3')
    await searchDraft(page, readyDraft)
    await expect(page.getByTestId('movie-picker')).toContainText('4 available loaded')
    const query = `${readyDraft.query} beta`
    const keys = await seedDraftSearch(query, [[readyDraft.movies[1]]])
    try {
      await page.getByTestId('movie-search-input').fill(query)
      await expect(page.getByTestId(`preview-movie-${readyDraft.movies[1].tmdb_id}`)).toBeVisible()
      await expect(page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`)).toHaveCount(0)
      await expect(page.getByLabel('Release window')).toBeDisabled()
      await expect(page.getByTestId('movie-picker')).toContainText('1 available loaded')
    } finally {
      await getAdminClient().from('tmdb_cache').delete().in('cache_key', keys)
    }
  })

  test('waiting players can preview movies but cannot submit a pick', async ({ leagueOwnerPage, authedPage, readyDraft }) => {
    await startDraft(leagueOwnerPage, readyDraft)
    await openDraft(authedPage, readyDraft)
    await searchDraft(authedPage, readyDraft)
    await authedPage.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`).click()
    await expect(authedPage.getByTestId('draft-movie-button')).toBeDisabled()
    await expect(authedPage.getByTestId('movie-quick-preview')).toContainText(/turn/i)
    expect(await readDraftPicks(readyDraft.id)).toHaveLength(0)
  })

  test('a committed pick updates the other player turn and progress through Realtime @critical @realtime', async ({
    leagueOwnerPage: owner, authedPage: nextPlayer, readyDraft,
  }) => {
    let deliveredPicks = 0
    nextPlayer.on('websocket', socket => {
      if (!socket.url().includes('/realtime/')) return
      socket.on('framereceived', frame => {
        try {
          const message = JSON.parse(frame.payload.toString())
          const event = Array.isArray(message) ? message[3] : message.event
          const payload = Array.isArray(message) ? message[4] : message.payload
          if (event === 'postgres_changes' && payload?.data?.table === 'draft_picks' &&
            payload.data.record?.league_id === readyDraft.id) deliveredPicks += 1
        } catch { /* Ignore protocol frames without JSON data. */ }
      })
    })
    await startDraft(owner, readyDraft)
    await openDraft(nextPlayer, readyDraft)
    await expect(nextPlayer.getByTestId('draft-connection-status')).toHaveText('Live')
    await searchDraft(owner, readyDraft)
    await pickMovie(owner, readyDraft.movies[0])
    // Less than the fallback polling interval, and the observer never reloads.
    await expect(nextPlayer.getByText("It's your turn!", { exact: true })).toBeVisible({ timeout: 7000 })
    await expect.poll(() => deliveredPicks).toBeGreaterThan(0)
    await expect(nextPlayer.getByTestId('draft-progress')).toContainText('1/3')
    await expect(nextPlayer.getByTestId('draft-connection-status')).toHaveText('Live')
    await expect(owner.getByTestId('draft-progress')).toContainText('1/3')
    const picks = await readDraftPicks(readyDraft.id)
    expect(picks).toHaveLength(1)
    expect(picks[0].team_id).toBe(readyDraft.teamIds[0])
    expect(picks[0].movies).toMatchObject({ tmdb_id: readyDraft.movies[0].tmdb_id, title: readyDraft.movies[0].title })
  })

  test('simultaneous selections for the same turn commit exactly one pick', async ({ leagueOwnerPage: first, leagueOwnerContext, readyDraft }) => {
    await startDraft(first, readyDraft)
    const second = await leagueOwnerContext.newPage()
    await openDraft(second, readyDraft)
    await Promise.all([searchDraft(first, readyDraft), searchDraft(second, readyDraft)])
    await first.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`).click()
    await second.getByTestId(`preview-movie-${readyDraft.movies[1].tmdb_id}`).click()
    await expect(first.getByTestId('draft-movie-button')).toBeEnabled()
    await expect(second.getByTestId('draft-movie-button')).toBeEnabled()
    let arrivals = 0
    let release!: () => void
    const bothSubmitted = new Promise<void>(resolve => { release = resolve })
    const statuses: number[] = []
    const record = (response: import('@playwright/test').Response) => {
      if (response.request().method() === 'POST' && response.url().endsWith('/functions/v1/draft-pick')) statuses.push(response.status())
    }
    first.on('response', record)
    second.on('response', record)
    await leagueOwnerContext.route('**/functions/v1/draft-pick', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      arrivals += 1
      if (arrivals === 2) release()
      await bothSubmitted
      await route.continue()
    })
    try {
      await Promise.all([first.getByTestId('draft-movie-button').click(), second.getByTestId('draft-movie-button').click()])
      await expect.poll(() => statuses.slice().sort()).toEqual([201, 409])
      expect(await readDraftPicks(readyDraft.id)).toHaveLength(1)
    } finally {
      release()
      await leagueOwnerContext.unroute('**/functions/v1/draft-pick')
      await second.close()
    }
  })

  test('a response lost after commit is reconciled and its receipt replays without another pick', async ({ leagueOwnerPage: page, readyDraft }) => {
    await startDraft(page, readyDraft)
    await searchDraft(page, readyDraft)
    let committedRequest: Request | undefined
    await page.route('**/functions/v1/draft-pick', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      committedRequest = route.request()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      await route.abort('failed') // SQL committed, but the browser loses its response.
    }, { times: 1 })
    await pickMovie(page, readyDraft.movies[0])
    await expect(page.getByTestId('draft-progress')).toContainText('1/3')
    expect(committedRequest).toBeDefined()
    const replay = await page.request.fetch(committedRequest!)
    expect(replay.status()).toBe(201)
    expect((await replay.json()).replayed).toBe(true)
    expect(await readDraftPicks(readyDraft.id)).toHaveLength(1)
  })

  test.describe('two-round snake draft', () => {
    test.use({ draftSlots: 2 })

    test('duplicate submissions cannot consume the consecutive turn at the round boundary @critical', async ({
      leagueOwnerPage: owner, leagueOwner, authedPage: second, secondUserPage: third, readyDraft,
    }, testInfo) => {
      test.setTimeout(120_000)
      const evidence = {
        join_has_access_token: [] as boolean[], join_has_owner_token: [] as boolean[], join_status: [] as string[],
        system_status: [] as string[], closes: 0,
      }
      const joinRefs = new Set<string>()
      const receivedPickIds = new Set<string>()
      owner.on('websocket', socket => {
        if (!socket.url().includes('/realtime/')) return
        socket.on('close', () => { evidence.closes += 1 })
        socket.on('framesent', frame => {
          try {
            const message = JSON.parse(frame.payload.toString())
            const topic = Array.isArray(message) ? message[2] : message.topic
            const event = Array.isArray(message) ? message[3] : message.event
            const payload = Array.isArray(message) ? message[4] : message.payload
            const ref = Array.isArray(message) ? message[1] : message.ref
            if (typeof topic === 'string' && topic.startsWith(`realtime:draft-${readyDraft.id}-`) && event === 'phx_join') {
              evidence.join_has_access_token.push(typeof payload?.access_token === 'string' && payload.access_token.length > 0)
              let hasOwnerToken = false
              try {
                const claims = JSON.parse(Buffer.from(payload.access_token.split('.')[1], 'base64url').toString('utf8'))
                hasOwnerToken = claims.sub === leagueOwner.id && claims.role === 'authenticated'
              } catch { /* Invalid or absent tokens produce only a false boolean. */ }
              evidence.join_has_owner_token.push(hasOwnerToken)
              if (typeof ref === 'string') joinRefs.add(ref)
            }
          } catch { /* Keep raw frames and credentials out of evidence. */ }
        })
        socket.on('framereceived', frame => {
          try {
            const message = JSON.parse(frame.payload.toString())
            const topic = Array.isArray(message) ? message[2] : message.topic
            const event = Array.isArray(message) ? message[3] : message.event
            const payload = Array.isArray(message) ? message[4] : message.payload
            const ref = Array.isArray(message) ? message[1] : message.ref
            if (typeof topic !== 'string' || !topic.startsWith(`realtime:draft-${readyDraft.id}-`)) return
            if (['ok', 'error', 'timeout'].includes(payload?.status)) {
              if (event === 'system') evidence.system_status.push(payload.status)
              if (event === 'phx_reply' && joinRefs.has(ref)) evidence.join_status.push(payload.status)
            }
            if (event === 'postgres_changes' && payload?.data?.table === 'draft_picks' &&
              payload.data.record?.league_id === readyDraft.id && typeof payload.data.record.id === 'string') {
              receivedPickIds.add(payload.data.record.id)
            }
          } catch { /* Keep raw frames and credentials out of evidence. */ }
        })
      })
      try {
        await startDraft(owner, readyDraft)
        await expect.poll(() => evidence.join_has_owner_token.length).toBeGreaterThan(0)
        expect(evidence.join_has_owner_token.every(Boolean)).toBe(true)
        for (const page of [second, third]) {
          await openDraft(page, readyDraft)
          await expect(page.getByTestId('draft-connection-status')).toHaveText('Live')
        }
        for (const [index, page] of [owner, second].entries()) {
          await expect(page.getByText("It's your turn!", { exact: true })).toBeVisible()
          await searchDraft(page, readyDraft)
          await pickMovie(page, readyDraft.movies[index])
        }

        await expect(third.getByText("It's your turn!", { exact: true })).toBeVisible()
        await searchDraft(third, readyDraft)
        let originalRequest: Request | undefined
        let duplicates: Array<{ status: number; id: string; replayed: boolean }> = []
        // Send the browser's exact authenticated request twice to the real Edge
        // handler, then deliver one real response to the UI. Neither response is stubbed.
        await third.route('**/functions/v1/draft-pick', async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return }
          originalRequest = route.request()
          const responses = await Promise.all([route.fetch(), route.fetch()])
          duplicates = await Promise.all(responses.map(async response => {
            const body = await response.json()
            return { status: response.status(), id: body.pick?.id, replayed: body.replayed }
          }))
          await route.fulfill({ response: responses[0] })
        })
        try {
          await pickMovie(third, readyDraft.movies[2])
        } finally {
          await third.unroute('**/functions/v1/draft-pick')
        }
        expect(duplicates.map(response => response.status)).toEqual([201, 201])
        expect(duplicates[0].id).toBeTruthy()
        expect(duplicates[0].id).toBe(duplicates[1].id)
        expect(duplicates.filter(response => response.replayed)).toHaveLength(1)
        expect(await readDraftPicks(readyDraft.id)).toHaveLength(3)
        await expect(third.getByTestId('draft-progress')).toContainText('3/6')
        await expect(third.getByText("It's your turn!", { exact: true })).toBeVisible()

        expect(originalRequest).toBeDefined()
        const originalBody = originalRequest!.postDataJSON()
        expect(originalBody.expected_pick).toBe(3)
        // A new selection from stale state must not steal this player's second
        // consecutive turn. Reuse the real browser auth, with a distinct receipt.
        const stale = await third.request.post(originalRequest!.url(), {
          headers: await originalRequest!.allHeaders(),
          data: { ...originalBody, tmdb_id: readyDraft.movies[3].tmdb_id, request_id: randomUUID() },
        })
        expect(stale.status()).toBe(409)
        expect(await readDraftPicks(readyDraft.id)).toHaveLength(3)

        const consecutiveRequest = third.waitForRequest(request =>
          request.method() === 'POST' && request.url().endsWith('/functions/v1/draft-pick'))
        await pickMovie(third, readyDraft.movies[3])
        const consecutiveBody = (await consecutiveRequest).postDataJSON()
        expect(consecutiveBody.expected_pick).toBe(4)
        expect(consecutiveBody.request_id).not.toBe(originalBody.request_id)
        for (const [index, page] of [second, owner].entries()) {
          await expect(page.getByText("It's your turn!", { exact: true })).toBeVisible()
          await searchDraft(page, readyDraft)
          await pickMovie(page, readyDraft.movies[index + 4])
        }

        const picks = await readDraftPicks(readyDraft.id)
        expect(picks.map(pick => ({ round: pick.round, pick: pick.pick_number, team: pick.team_id }))).toEqual([
          { round: 1, pick: 1, team: readyDraft.teamIds[0] },
          { round: 1, pick: 2, team: readyDraft.teamIds[1] },
          { round: 1, pick: 3, team: readyDraft.teamIds[2] },
          { round: 2, pick: 1, team: readyDraft.teamIds[2] },
          { round: 2, pick: 2, team: readyDraft.teamIds[1] },
          { round: 2, pick: 3, team: readyDraft.teamIds[0] },
        ])
        expect(new Set(picks.map(pick => pick.movie_id)).size).toBe(6)
        await expect(owner.getByRole('button', { name: 'Start counterpick round', exact: true })).toBeVisible()
        for (const page of [owner, second, third]) {
          await expect(page.getByTestId('draft-progress')).toContainText('6/6')
        }
        expect(evidence.join_has_owner_token.every(Boolean)).toBe(true)
      } finally {
        await testInfo.attach('owner-realtime-evidence', {
          body: JSON.stringify({ ...evidence, received_pick_ids: [...receivedPickIds] }),
          contentType: 'application/json',
        })
      }
    })
  })

  test('all draft picks and counterpicks activate the league with its configured budgets @critical', async ({
    leagueOwnerPage: owner, authedPage: second, secondUserPage: third, readyDraft,
  }) => {
    // Three authenticated players perform six real mutations and a phase change.
    test.setTimeout(120_000)
    await startDraft(owner, readyDraft)
    for (const page of [second, third]) await openDraft(page, readyDraft)
    for (const [index, page] of [owner, second, third].entries()) {
      await expect(page.getByText("It's your turn!", { exact: true })).toBeVisible()
      await searchDraft(page, readyDraft)
      await pickMovie(page, readyDraft.movies[index])
    }
    await owner.getByRole('button', { name: 'Start counterpick round', exact: true }).click()
    // Reverse order: third targets second, second targets owner, owner targets third.
    for (const [page, movie] of [[third, readyDraft.movies[1]], [second, readyDraft.movies[0]], [owner, readyDraft.movies[2]]] as const) {
      await expect(page.getByRole('heading', { name: 'Select movie to counterpick', exact: true })).toBeVisible()
      await page.getByRole('button').filter({ hasText: movie.title }).click()
      await page.getByRole('button', { name: 'Confirm Counterpick', exact: true }).click()
    }
    for (const page of [owner, second, third]) {
      await expect(page.getByRole('heading', { name: 'Draft results', exact: true })).toBeVisible()
    }
    const admin = getAdminClient()
    const { data: league, error: leagueError } = await admin.from('leagues').select('status').eq('id', readyDraft.id).single()
    expect(leagueError).toBeNull()
    expect(league?.status).toBe('active')
    const { data: budgets, error: budgetError } = await admin.from('team_budgets').select('remaining_budget').in('team_id', readyDraft.teamIds)
    expect(budgetError).toBeNull()
    expect(budgets?.map(row => row.remaining_budget)).toEqual([137, 137, 137])
    const { data: scores, error: scoresError } = await admin.from('team_scores')
      .select('team_id,total_points,draft_points,counterpick_points,movies_pending,movies_scored,counterpicks_made,counterpicks_scored')
      .in('team_id', readyDraft.teamIds)
    expect(scoresError).toBeNull()
    expect(scores).toHaveLength(3)
    for (const teamId of readyDraft.teamIds) {
      expect(scores?.find(score => score.team_id === teamId)).toMatchObject({
        total_points: 0, draft_points: 0, counterpick_points: 0,
        movies_pending: 1, movies_scored: 0, counterpicks_made: 1, counterpicks_scored: 0,
      })
    }
  })
})
