import { test, expect, startDraft, searchDraft, readDraftPicks } from '../../fixtures/draft.fixture'
import { getAdminClient } from '../../helpers/supabase.helper'
import { seedDraftMovieCache, seedDraftSearch } from '../../helpers/draft-cache.helper'

for (const width of [1280, 390]) {
  test(`preview keeps selection on server rejection, guards pending actions, and restores focus (${width}px)`, async ({ leagueOwnerPage: page, readyDraft }) => {
    await page.setViewportSize({ width, height: 900 })
    await startDraft(page, readyDraft)
    await searchDraft(page, readyDraft)
    const movie = readyDraft.movies[0]
    const opener = page.getByTestId(`preview-movie-${movie.tmdb_id}`)
    await opener.focus()
    await page.keyboard.press('Enter')
    const preview = page.getByTestId('movie-quick-preview')
    await expect(preview).toHaveAttribute('open', '')
    await expect(page.getByTestId('draft-movie-button')).toBeEnabled()
    await expect(preview).not.toContainText(/8\.7|87,654|87654|TMDb rating|\bNaN\b/)
    const actions = await page.getByTestId('movie-preview-actions').boundingBox()
    expect(actions).not.toBeNull()
    expect(actions!.y).toBeGreaterThanOrEqual(0)
    expect(actions!.y + actions!.height).toBeLessThanOrEqual(901)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await preview.evaluate(dialog => dialog.contains(document.activeElement) ||
        (!document.hasFocus() && document.activeElement === document.body))).toBe(true)
    }
    await preview.focus()
    await opener.evaluate(button => button.focus())
    expect(await preview.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true)
    // Availability changes after the preview loaded. The real handler must
    // reject the now-canceled canonical movie while retaining the selection.
    await seedDraftMovieCache([movie], { status: 'Canceled' })
    let release!: () => void
    const send = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    await page.route('**/functions/v1/draft-pick', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      requests += 1
      await send
      await route.continue()
    })
    try {
      await page.getByTestId('draft-movie-button').click()
      await expect.poll(() => requests).toBe(1)
      await expect(page.getByTestId('draft-movie-button')).toBeDisabled()
      await page.getByTestId('draft-movie-button').evaluate(button => (button as HTMLButtonElement).click())
      await page.keyboard.press('Escape')
      await expect(preview).toBeVisible()
      await expect(preview.getByRole('button', { name: 'Close movie preview' })).toBeDisabled()
      expect(requests).toBe(1)
      release()
      await expect(preview.getByRole('alert')).toContainText(/not available for drafting/)
      await expect(preview.getByRole('heading')).toContainText(movie.title)
      expect(await readDraftPicks(readyDraft.id)).toHaveLength(0)
      await seedDraftMovieCache([movie])
      await page.getByTestId('draft-movie-button').click()
      await expect(preview).toHaveCount(0)
      await expect(opener).toBeFocused()
      expect(requests).toBe(2)
      expect(await readDraftPicks(readyDraft.id)).toHaveLength(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    } finally {
      release()
      await page.unroute('**/functions/v1/draft-pick')
    }
  })
}

test('movie details failure is visible and can be retried in the same native dialog', async ({ leagueOwnerPage: page, readyDraft }) => {
  await startDraft(page, readyDraft)
  await searchDraft(page, readyDraft)
  let unavailable = true
  await page.route('**/functions/v1/get-movie-details', async route => {
    if (route.request().method() === 'POST' && unavailable) await route.abort('failed')
    else await route.continue()
  })
  await page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`).click()
  const preview = page.getByTestId('movie-quick-preview')
  await expect(preview.getByTestId('retry-movie-details')).toBeVisible()
  await expect(preview.getByTestId('draft-movie-button')).toBeDisabled()
  unavailable = false
  await preview.getByTestId('retry-movie-details').click()
  await expect(preview.getByTestId('draft-movie-button')).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`)).toBeFocused()
})

test('empty eligible pages advance only three pages, with explicit load and retry for the remainder', async ({ leagueOwnerPage: page, readyDraft }) => {
  const query = `${readyDraft.query} pages`
  const keys = await seedDraftSearch(query, [[], [], [], [readyDraft.movies[0]]])
  const requests: number[] = []
  let failNextPage = true
  await page.route('**/functions/v1/search-movies', async route => {
    const request = route.request()
    const body = request.method() === 'POST' ? request.postDataJSON() : null
    if (body?.query === query) {
      requests.push(body.page)
      if (body.page === 4 && failNextPage) {
        failNextPage = false
        await route.abort('failed')
        return
      }
    }
    await route.continue()
  })
  try {
    await startDraft(page, readyDraft)
    await page.getByTestId('movie-search-input').fill(query)
    const picker = page.getByTestId('movie-picker')
    await expect(picker).toContainText('No available movies in the pages loaded so far.')
    await expect.poll(() => requests.slice()).toEqual([1, 2, 3])
    await picker.getByTestId('load-more-movies-button').click()
    await expect(picker.getByTestId('retry-movies-button')).toBeVisible()
    await picker.getByTestId('retry-movies-button').click()
    await expect(page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`)).toBeVisible()
    await expect(picker).toContainText('1 available loaded')
    await expect(picker.getByTestId('load-more-movies-button')).toHaveCount(0)
  } finally {
    await getAdminClient().from('tmdb_cache').delete().in('cache_key', keys)
  }
})

test('wishlist read failure retries, then title search stays local with unsupported filters disabled', async ({ leagueOwnerPage: page, leagueOwner, readyDraft }) => {
  const admin = getAdminClient()
  const { error } = await admin.from('wishlisted_movies').insert(readyDraft.movies.slice(0, 2).map(movie => ({
    user_id: leagueOwner.id, tmdb_id: movie.tmdb_id, title: movie.title, poster_url: null,
  })))
  expect(error).toBeNull()
  let failWishlist = true
  await page.route('**/rest/v1/wishlisted_movies*', async route => {
    if (route.request().method() === 'GET' && failWishlist) await route.abort('failed')
    else await route.continue()
  })
  await startDraft(page, readyDraft)
  await page.getByTestId('movie-tab-wishlist').click()
  await expect(page.getByTestId('movie-picker')).toContainText('Could not load your wishlist')
  await expect(page.getByTestId('movie-picker')).not.toContainText('Your wishlist is empty')
  failWishlist = false
  await page.getByTestId('retry-movies-button').click()
  await expect(page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`)).toBeVisible()
  let searchRequests = 0
  page.on('request', request => {
    if (request.url().endsWith('/functions/v1/search-movies')) searchRequests += 1
  })
  await page.getByTestId('movie-search-input').fill('Beta')
  await expect(page.getByTestId(`preview-movie-${readyDraft.movies[1].tmdb_id}`)).toBeVisible()
  await expect(page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`)).toHaveCount(0)
  await expect(page.getByLabel('Release window')).toBeDisabled()
  await expect(page.getByTestId('movie-picker')).toContainText('Search filters your wishlist')
  // Include the remote search debounce window when asserting no request.
  await page.waitForTimeout(350)
  expect(searchRequests).toBe(0)
})
