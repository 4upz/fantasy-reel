import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/league.fixture'
import { createTeamBudget, getAdminClient } from '../../helpers/supabase.helper'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

/** Hold real Supabase responses so assertions decide when loading can finish. */
async function delayBudget(page: Page, teamId: string, release: Promise<void>) {
  await page.route('**/rest/v1/team_budgets?*', async (route) => {
    if (route.request().method() !== 'GET' ||
      new URL(route.request().url()).searchParams.get('team_id') !== `eq.${teamId}`) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    await release
    await route.fulfill({ response })
  })
}

async function observeOwnRoster(page: Page, teamId: string, release = Promise.resolve()) {
  const requests = { holdings: 0, counterpicks: 0, completed: 0 }
  await page.route(/\/rest\/v1\/(team_holdings|counterpicks)\?/, async (route) => {
    const url = new URL(route.request().url())
    const isHoldings = url.pathname.endsWith('/team_holdings')
    const teamFilter = url.searchParams.get(isHoldings ? 'team_id' : 'counterpicker_team_id')
    if (route.request().method() !== 'GET' || teamFilter !== `eq.${teamId}`) {
      await route.continue()
      return
    }
    requests[isHoldings ? 'holdings' : 'counterpicks'] += 1
    const response = await route.fetch()
    await release
    await route.fulfill({ response })
    requests.completed += 1
  })
  return requests
}

test.describe('Trading loading @trading', () => {
  test('shows offers and actions while the budget loads without eagerly fetching the roster', async ({
    authedPage: page,
    tradingLeagueWithTrade: league,
  }) => {
    await createTeamBudget(league.testUserTeamId, 37)
    const budget = deferred()
    await delayBudget(page, league.testUserTeamId, budget.promise)
    const roster = await observeOwnRoster(page, league.testUserTeamId)
    const panel = page.getByTestId('trading-panel')
    const balance = panel.getByText('Available budget:', { exact: false })

    try {
      await page.goto(`/league/${league.id}/trading`)
      await expect(page.getByTestId(`trade-card-${league.tradeOfferId}`)).toBeVisible()
      await expect(panel.getByRole('status', { name: 'Loading budget' })).toBeVisible()
      await expect(page.getByTestId('propose-trade-button')).toBeEnabled()
      await expect(page.getByTestId(`counter-trade-${league.tradeOfferId}`)).toBeEnabled()
      await expect(page.getByTestId(`accept-trade-${league.tradeOfferId}`)).toBeEnabled()
      await expect(balance).not.toContainText(/\$(?:0|100)\b/)
      expect(roster.holdings).toBe(0)
      expect(roster.counterpicks).toBe(0)
    } finally {
      budget.resolve()
    }

    await expect(balance).toContainText('$37')
    await expect(panel.getByRole('status', { name: 'Loading budget' })).not.toBeVisible()
    expect(roster.holdings).toBe(0)
    expect(roster.counterpicks).toBe(0)
  })

  test('mobile composition loads the roster on demand and can be cancelled before it arrives', async ({
    authedPage: page,
    tradingLeagueWithTrade: league,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await createTeamBudget(league.testUserTeamId, 37)
    const response = deferred()
    const roster = await observeOwnRoster(page, league.testUserTeamId, response.promise)
    const offer = page.getByTestId(`trade-card-${league.tradeOfferId}`)
    const preparing = page.getByRole('dialog', { name: 'Preparing trade', exact: true })

    try {
      await page.goto(`/league/${league.id}/trading`)
      await expect(offer).toBeVisible()
      expect(roster.holdings).toBe(0)
      expect(roster.counterpicks).toBe(0)

      await page.getByTestId('propose-trade-button').click()
      await expect(preparing).toBeVisible({ timeout: 1000 })
      await expect(preparing.getByRole('status', { name: 'Loading trade details' })).toBeVisible()
      await expect.poll(() => roster.holdings).toBe(1)
      await expect.poll(() => roster.counterpicks).toBe(1)
      await preparing.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(preparing).not.toBeVisible()
      await expect(offer).toBeVisible()
    } finally {
      response.resolve()
    }

    await expect.poll(() => roster.completed).toBe(2)
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.getByTestId('propose-trade-button').click()
    const proposal = page.getByRole('dialog', { name: 'Select Trade Partner', exact: true })
    await expect(proposal).toBeVisible()
    await proposal.getByRole('option', { name: /Owner Team/ }).click()
    await expect(page.getByRole('dialog').getByRole('option', { name: /Trade Offer Movie Beta/ })).toBeVisible()
  })

  test('a failed roster stays in the preparation dialog and retries without removing offers', async ({
    authedPage: page,
    tradingLeagueWithTrade: league,
  }) => {
    await createTeamBudget(league.testUserTeamId, 37)
    let failRoster = true
    let rosterRequests = 0
    await page.route('**/rest/v1/team_holdings?*', async (route) => {
      if (route.request().method() !== 'GET' ||
        new URL(route.request().url()).searchParams.get('team_id') !== `eq.${league.testUserTeamId}`) {
        await route.continue()
        return
      }
      rosterRequests += 1
      if (failRoster) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporarily unavailable' }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto(`/league/${league.id}/trading`)
    const offer = page.getByTestId(`trade-card-${league.tradeOfferId}`)
    await expect(offer).toBeVisible()
    expect(rosterRequests).toBe(0)
    await page.getByTestId('propose-trade-button').click()
    const preparing = page.getByRole('dialog', { name: 'Preparing trade', exact: true })
    await expect(preparing.getByRole('alert')).toBeVisible()
    await expect(preparing.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled()
    await expect(offer).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Select Trade Partner', exact: true })).not.toBeVisible()

    failRoster = false
    await preparing.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Select Trade Partner', exact: true })).toBeVisible()
    await expect(preparing).not.toBeVisible()
    expect(rosterRequests).toBeGreaterThanOrEqual(2)
    await page.getByRole('option', { name: /Owner Team/ }).click()
    await expect(page.getByRole('dialog').getByRole('option', { name: /Trade Offer Movie Beta/ })).toBeVisible()
  })

  test('countering an offer waits for the budget even after its roster has loaded', async ({
    authedPage: page,
    tradingLeagueWithTrade: league,
  }) => {
    await createTeamBudget(league.testUserTeamId, 37)
    const budget = deferred()
    await delayBudget(page, league.testUserTeamId, budget.promise)
    const roster = await observeOwnRoster(page, league.testUserTeamId)
    const preparing = page.getByRole('dialog', { name: 'Preparing trade', exact: true })

    try {
      await page.goto(`/league/${league.id}/trading`)
      await page.getByTestId(`counter-trade-${league.tradeOfferId}`).click()
      await expect(preparing).toBeVisible({ timeout: 1000 })
      await expect.poll(() => roster.completed).toBe(2)
      await expect(preparing.getByRole('status', { name: 'Loading trade details' })).toBeVisible()
      await expect(page.getByRole('dialog', { name: /Counter trade with/ })).not.toBeVisible()
      await expect(page.getByTestId(`trade-card-${league.tradeOfferId}`)).toBeVisible()
    } finally {
      budget.resolve()
    }

    const counter = page.getByRole('dialog', { name: /Counter trade with Owner Team/ })
    await expect(counter).toBeVisible()
    await expect(preparing).not.toBeVisible()
    await expect(counter.getByRole('option', { name: /Trade Offer Movie Beta/ })).toBeVisible()
  })

  test('a loaded absent budget stays unavailable and allows composing a movie trade', async ({
    authedPage: page,
    tradingLeague: league,
  }) => {
    const { error } = await getAdminClient().from('team_budgets').delete().eq('team_id', league.testUserTeamId)
    if (error) throw error
    await page.goto(`/league/${league.id}/trading`)
    const panel = page.getByTestId('trading-panel')
    const balance = panel.getByText('Available budget:', { exact: false })
    await expect(balance).toContainText('Unavailable')
    await expect(balance).not.toContainText(/\$(?:0|100)\b/)
    await expect(panel.getByRole('status', { name: 'Loading budget' })).not.toBeVisible()
    await page.getByTestId('propose-trade-button').click()
    await page.getByRole('dialog', { name: 'Select Trade Partner', exact: true })
      .getByRole('option', { name: /Owner Team/ }).click()

    const proposal = page.getByRole('dialog')
    await expect(proposal.getByRole('option', { name: /Trade Movie Beta/ })).toBeVisible()
    await proposal.getByRole('option', { name: /Trade Movie Beta/ }).click()
    await proposal.getByRole('option', { name: /Trade Movie Alpha/ }).click()
    await expect(proposal.getByRole('button', { name: 'Submit trade proposal', exact: true })).toBeEnabled()
    await expect(page.getByRole('dialog', { name: 'Preparing trade', exact: true })).not.toBeVisible()
  })

  test('a movie counter clears an inherited budget amount when the team budget is absent', async ({
    authedPage: page,
    tradingLeagueWithTrade: league,
  }) => {
    const admin = getAdminClient()
    const { data: holdings, error: holdingsError } = await admin
      .from('team_holdings')
      .select('holding_id, movie_id, title')
      .eq('league_id', league.id)
    if (holdingsError) throw holdingsError
    const ownerHolding = holdings?.find((holding) => holding.movie_id === league.ownerMovieId)
    const ownHolding = holdings?.find((holding) => holding.movie_id === league.testUserMovieId)
    if (!ownerHolding || !ownHolding) throw new Error('Trading fixture is missing its movie holdings')

    // Use complete source references so the counter reaches real ownership validation.
    const { error: tradeError } = await admin.from('trade_offers').update({
      initiator_items: {
        movies: [{ movie_id: ownerHolding.movie_id, source: 'draft_pick', source_id: ownerHolding.holding_id, title: ownerHolding.title }],
        faab: 0,
      },
      recipient_items: {
        movies: [{ movie_id: ownHolding.movie_id, source: 'draft_pick', source_id: ownHolding.holding_id, title: ownHolding.title }],
        faab: 20,
      },
    }).eq('id', league.tradeOfferId)
    if (tradeError) throw tradeError
    const { error: budgetError } = await admin.from('team_budgets').delete().eq('team_id', league.testUserTeamId)
    if (budgetError) throw budgetError

    await page.goto(`/league/${league.id}/trading`)
    await expect(page.getByTestId('trading-panel').getByText('Available budget:', { exact: false }))
      .toContainText('Unavailable')
    await page.getByTestId(`counter-trade-${league.tradeOfferId}`).click()
    const counter = page.getByRole('dialog', { name: /Counter trade with Owner Team/ })
    const amount = counter.getByRole('spinbutton', { name: 'Budget unavailable', exact: true })
    await expect(amount).toBeDisabled()
    await expect(amount).toHaveValue('0')

    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/functions/v1/counter-trade') &&
      response.request().method() === 'POST'
    )
    await counter.getByRole('button', { name: 'Submit counter offer', exact: true }).click()
    const response = await responsePromise
    const request = response.request().postDataJSON()
    expect(request.counter_offered_items.faab).toBe(0)
    expect(request.counter_offered_items.movies).toEqual([
      { movie_id: ownHolding.movie_id, source: 'draft_pick', source_id: ownHolding.holding_id },
    ])
    expect(response.status()).toBe(200)
    const result = await response.json()
    expect(result.trade_offer.status).toBe('countered')
    expect(result.trade_offer.initiator_items.faab).toBe(0)
    await expect(counter).not.toBeVisible()
  })
})
