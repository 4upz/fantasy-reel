import type { Request } from '@playwright/test'
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
    const { count, error: scoresError } = await admin.from('team_scores').select('id', { count: 'exact', head: true }).in('team_id', readyDraft.teamIds)
    expect(scoresError).toBeNull()
    expect(count).toBe(3)
  })
})
