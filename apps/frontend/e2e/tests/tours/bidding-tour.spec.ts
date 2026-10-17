import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/league.fixture'
import { setupAllMocks } from '../../helpers/mock-api.helper'
import { scanA11y } from '../../helpers/a11y.helper'

/**
 * Guided tours E2E, through the bidding tour (the engine's reference tour).
 *
 * Tours don't start by themselves under automation, so every other spec is
 * unaffected; these opt in with `window.__FANTASY_REEL_TOURS__` before the
 * page loads. Each test gets a fresh test user, so no tour has been seen yet.
 *
 * Key UI elements:
 * - tour-card: the step card (data-tour-id names the tour)
 * - tour-next: Next / Finish
 * - tour-dont-show: Don't show again
 * - tour-replay: "Show me around" on the page
 * - tour-preferences / tours-reset-all: Settings → Tours
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

test.describe('Guided tours @tours', () => {
  test.beforeEach(async ({ authedPage }) => {
    await setupAllMocks(authedPage)
    await optIntoTours(authedPage)
  })

  test('the bidding tour starts on a first visit and is accessible @critical', async ({
    authedPage,
    biddingLeague,
  }, testInfo) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    const card = authedPage.getByTestId('tour-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toHaveAttribute('data-tour-id', 'bidding')
    await expect(authedPage.getByRole('dialog', { name: 'Pick up movies the draft missed' })).toBeVisible()

    const violations = await scanA11y(authedPage, testInfo, 'bidding tour card', { include: '[data-testid="tour-card"]' })
    expect(violations).toEqual([])

    await finishTour(authedPage)
    await expect(card).toHaveCount(0)

    // Finished tours don't start again.
    await authedPage.reload()
    await expect(authedPage.getByTestId('bidding-panel')).toBeVisible({ timeout: 10000 })
    await authedPage.waitForTimeout(3000)
    await expect(card).toHaveCount(0)

    // ...but can always be replayed.
    await authedPage.getByTestId('tour-replay').click()
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-tour-id', 'bidding')
  })

  test('Escape snoozes the tour', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    const card = authedPage.getByTestId('tour-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await authedPage.keyboard.press('Escape')
    await expect(card).toHaveCount(0)

    // Snoozed for three days: a reload doesn't bring it back.
    await authedPage.reload()
    await expect(authedPage.getByTestId('bidding-panel')).toBeVisible({ timeout: 10000 })
    await authedPage.waitForTimeout(3000)
    await expect(card).toHaveCount(0)
  })

  test('Settings can show a hidden tour again', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    const card = authedPage.getByTestId('tour-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await authedPage.getByTestId('tour-dont-show').click()
    await expect(card).toHaveCount(0)

    await authedPage.goto('/settings')
    const preferences = authedPage.getByTestId('tour-preferences')
    await expect(preferences).toBeVisible({ timeout: 10000 })
    await expect(preferences).toContainText('Hidden')
    await authedPage.getByTestId('tours-reset-all').click()
    await expect(preferences).toContainText('Not seen yet')

    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await expect(card).toBeVisible({ timeout: 15000 })
  })

  test('turning tours off stops them starting by themselves', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto('/settings')
    const toggle = authedPage.getByTestId('tours-enabled-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10000 })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await expect(authedPage.getByTestId('bidding-panel')).toBeVisible({ timeout: 10000 })
    await authedPage.waitForTimeout(3000)
    await expect(authedPage.getByTestId('tour-card')).toHaveCount(0)
  })
})
