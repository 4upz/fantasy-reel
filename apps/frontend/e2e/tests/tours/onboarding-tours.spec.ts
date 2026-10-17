import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/league.fixture'
import { setupAllMocks } from '../../helpers/mock-api.helper'
import { scanA11y } from '../../helpers/a11y.helper'

/**
 * The new-player onboarding path: the welcome tour, the setup tours on the
 * Draft tab, the draft room tour, and the dashboard's Next step card.
 *
 * Tours are opted into with `window.__FANTASY_REEL_TOURS__` (see
 * bidding-tour.spec.ts). Each test user is fresh, so nobody has seen a tour,
 * and a user counts as a newcomer until they have a season past its draft.
 *
 * Key UI elements:
 * - tour-card (data-tour-id names the tour), tour-next, tour-replay
 * - next-step / next-step-hide: the dashboard's Next step card
 * - start-draft-button
 */

declare global {
  interface Window {
    __FANTASY_REEL_TOURS__?: boolean
  }
}

async function optIntoTours(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__FANTASY_REEL_TOURS__ = true
  })
}

async function finishTour(page: Page): Promise<void> {
  const next = page.getByTestId('tour-next')
  for (let step = 0; step < 5; step++) {
    const label = (await next.textContent())?.trim()
    await next.click()
    if (label === 'Finish') return
  }
  throw new Error('The tour never reached Finish')
}

test.describe('Onboarding tours @tours', () => {
  test('a newcomer gets the welcome tour on an empty dashboard @critical', async ({ authedPage }, testInfo) => {
    await setupAllMocks(authedPage)
    await optIntoTours(authedPage)
    await authedPage.goto('/dashboard')

    const card = authedPage.getByTestId('tour-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toHaveAttribute('data-tour-id', 'welcome')
    await expect(authedPage.getByRole('dialog', { name: 'Fantasy sports, for movies' })).toBeVisible()

    const violations = await scanA11y(authedPage, testInfo, 'welcome tour card', { include: '[data-testid="tour-card"]' })
    expect(violations).toEqual([])

    await finishTour(authedPage)
    await expect(card).toHaveCount(0)

    await authedPage.reload()
    await expect(authedPage.getByTestId('create-league-button').first()).toBeVisible({ timeout: 10000 })
    await authedPage.waitForTimeout(3000)
    await expect(card).toHaveCount(0)
  })

  test('a player waiting on the draft gets the waiting tour and a next step', async ({ authedPage, draftReadyLeague }) => {
    await setupAllMocks(authedPage)
    await optIntoTours(authedPage)

    await authedPage.goto('/dashboard')
    const nextStep = authedPage.getByTestId('next-step')
    await expect(nextStep).toContainText('hasn’t drafted yet', { timeout: 15000 })

    await authedPage.goto(`/league/${draftReadyLeague.id}/draft`)
    const card = authedPage.getByTestId('tour-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toHaveAttribute('data-tour-id', 'league-waiting')
    await expect(authedPage.getByRole('dialog', { name: 'Draft day happens here' })).toBeVisible()
    await finishTour(authedPage)

    // Hiding the card is remembered.
    await authedPage.goto('/dashboard')
    await authedPage.getByTestId('next-step-hide').click()
    await expect(nextStep).toHaveCount(0)
    await authedPage.reload()
    await expect(authedPage.getByRole('heading', { name: 'Your leagues' })).toBeVisible({ timeout: 10000 })
    await expect(nextStep).toHaveCount(0)
  })

  test('the commissioner gets the setup tour, then the draft room tour as the draft starts', async ({
    leagueOwnerPage,
    draftReadyLeague,
  }) => {
    await setupAllMocks(leagueOwnerPage)
    await optIntoTours(leagueOwnerPage)
    await leagueOwnerPage.goto(`/league/${draftReadyLeague.id}/draft`)

    const card = leagueOwnerPage.getByTestId('tour-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toHaveAttribute('data-tour-id', 'league-setup')
    await finishTour(leagueOwnerPage)
    await expect(card).toHaveCount(0)

    // Same page, new phase: its tour starts without a reload.
    await leagueOwnerPage.getByTestId('start-draft-button').click()
    await expect(leagueOwnerPage.getByTestId('draft-board')).toBeVisible({ timeout: 30000 })
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toHaveAttribute('data-tour-id', 'draft-room')
  })

  test('a returning player is not walked through, but can ask', async ({ authedPage, activeLeague }) => {
    void activeLeague
    await setupAllMocks(authedPage)
    await optIntoTours(authedPage)
    await authedPage.goto('/dashboard')

    await expect(authedPage.getByRole('heading', { name: 'Your leagues' })).toBeVisible({ timeout: 10000 })
    await authedPage.waitForTimeout(3000)
    await expect(authedPage.getByTestId('tour-card')).toHaveCount(0)
    await expect(authedPage.getByTestId('next-step')).toHaveCount(0)

    await authedPage.getByTestId('tour-replay').click()
    await expect(authedPage.getByTestId('tour-card')).toHaveAttribute('data-tour-id', 'welcome')
  })
})
