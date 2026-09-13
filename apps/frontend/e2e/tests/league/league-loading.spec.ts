import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/league.fixture'
import { createTeamBudget, getAdminClient, getTeamId } from '../../helpers/supabase.helper'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function expectNoGlimmersDuring(page: Page, navigate: () => Promise<void>, selector = '[data-testid="league-tab-loading"]') {
  // Final-state assertions miss glimmers that mount and disappear during a fast
  // cached navigation. Observe insertions for the entire transition instead.
  const observation = await page.evaluateHandle((selector) => {
    const state = { count: document.querySelectorAll(selector).length }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) {
            state.count += 1
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return { state, observer }
  }, selector)
  try {
    await navigate()
    expect(await observation.evaluate(({ state }) => state.count), 'Navigation should never insert a loading glimmer').toBe(0)
  } finally {
    await observation.evaluate(({ observer }) => observer.disconnect())
    await observation.dispose()
  }
}

test('selects the destination and retains available content before a slow tab response arrives', async ({ authedPage: page, activeLeague }) => {
  const response = deferred()
  await page.route(`**/league/${activeLeague.id}/trading?*`, async (route) => {
    await response.promise
    await route.continue()
  })
  await page.goto(`/league/${activeLeague.id}/dashboard`)
  await expect(page.getByTestId('team-header')).toBeVisible()

  const tab = page.getByTestId('league-tabs').getByRole('link', { name: 'Trading' })
  try {
    await expectNoGlimmersDuring(page, async () => {
      await tab.click()
      await expect(tab).toHaveAttribute('aria-current', 'page', { timeout: 1000 })
      await expect(tab).toHaveAttribute('aria-busy', 'true')
      await expect(page.getByTestId('team-header')).toBeVisible()
      await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
    })
  } finally {
    response.resolve()
  }
  await expect(page.getByTestId('trading-panel')).toBeVisible()
  await expect(tab).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
})

test('cached tabs and browser history never flash route glimmers', async ({ authedPage: page, activeLeague }) => {
  await page.goto(`/league/${activeLeague.id}/dashboard`)
  await expect(page.getByTestId('team-header')).toBeVisible()
  const nav = page.getByTestId('league-tabs')
  const trading = nav.getByRole('link', { name: 'Trading' })
  const overview = nav.getByRole('link', { name: 'Overview' })
  await trading.click()
  await expect(page.getByTestId('trading-panel')).toBeVisible()
  await expect(trading).not.toHaveAttribute('aria-busy', 'true')

  await expectNoGlimmersDuring(page, async () => {
    await overview.click()
    await expect(page.getByTestId('team-header')).toBeVisible()
    await expect(overview).toHaveAttribute('aria-current', 'page')
    await expect(overview).not.toHaveAttribute('aria-busy', 'true')
    await trading.click()
    await expect(page.getByTestId('trading-panel')).toBeVisible()
    await expect(trading).not.toHaveAttribute('aria-busy', 'true')
    await page.goBack()
    await expect(page.getByTestId('team-header')).toBeVisible()
    await expect(overview).toHaveAttribute('aria-current', 'page')
    await page.goForward()
    await expect(page.getByTestId('trading-panel')).toBeVisible()
    await expect(trading).toHaveAttribute('aria-current', 'page')
  })
})

test('mobile More closes immediately and retains available content while its destination loads', async ({ authedPage: page, activeLeague }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const response = deferred()
  await page.route(`**/league/${activeLeague.id}/trading?*`, async (route) => {
    await response.promise
    await route.continue()
  })
  await page.goto(`/league/${activeLeague.id}/dashboard`)
  await expect(page.getByTestId('team-header')).toBeVisible()
  await page.getByTestId('league-bottom-nav').getByRole('button', { name: 'More' }).click()
  const sheet = page.getByRole('dialog', { name: 'More league pages' })
  try {
    await expectNoGlimmersDuring(page, async () => {
      await sheet.getByRole('link', { name: 'Trading' }).click()
      await expect(sheet).not.toBeVisible({ timeout: 1000 })
      await expect(page.getByTestId('team-header')).toBeVisible()
      await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
    })
  } finally {
    response.resolve()
  }
  await expect(page.getByTestId('trading-panel')).toBeVisible()
  await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
})

test('a newer tab selection wins while the previous response is delayed', async ({ authedPage: page, activeLeague }) => {
  const response = deferred()
  await page.route(`**/league/${activeLeague.id}/trading?*`, async (route) => {
    await response.promise
    await route.continue()
  })
  await page.goto(`/league/${activeLeague.id}/dashboard`)
  await expect(page.getByTestId('team-header')).toBeVisible()
  const nav = page.getByTestId('league-tabs')
  const standings = nav.getByRole('link', { name: 'Standings' })
  try {
    await nav.getByRole('link', { name: 'Trading' }).click()
    await expect(nav.getByRole('link', { name: 'Trading' })).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByTestId('team-header')).toBeVisible()
    await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
    await standings.click()
    await expect(standings).toHaveAttribute('aria-current', 'page', { timeout: 1000 })
  } finally {
    response.resolve()
  }
  await expect(page).toHaveURL(new RegExp(`/league/${activeLeague.id}/standings$`))
  await expect(page.getByTestId('standings-container')).toBeVisible()
  await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
  await expect(standings).toHaveAttribute('aria-current', 'page')
})

test('a redirected tab restores the final route without leaving a loading state', async ({ authedPage: page, activeLeague }) => {
  const { error } = await getAdminClient().from('leagues').update({ trades_enabled: false }).eq('id', activeLeague.id)
  if (error) throw error
  await page.goto(`/league/${activeLeague.id}/dashboard`)
  await expect(page.getByTestId('team-header')).toBeVisible()
  const nav = page.getByTestId('league-tabs')
  await nav.getByRole('link', { name: 'Trading' }).click()
  await expect(page).toHaveURL(new RegExp(`/league/${activeLeague.id}/dashboard$`))
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('team-header')).toBeVisible()
  await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
})

test('bidding never displays a default budget while the real balance is loading', async ({ authedPage: page, biddingLeague }) => {
  const { error } = await getAdminClient().from('team_budgets').update({ remaining_budget: 37 }).eq('team_id', biddingLeague.teamId)
  if (error) throw error
  const budget = deferred()
  await page.route('**/rest/v1/team_budgets?*', async (route) => {
    await budget.promise
    await route.continue()
  })
  try {
    await page.goto(`/league/${biddingLeague.id}/bidding`)
    await expect(page.getByTestId('bidding-panel')).toBeVisible()
    await expect(page.getByTestId('place-bid-button')).toBeDisabled()
    await expect(page.getByTestId('bidding-panel')).not.toContainText('$100')
    await expect(page.getByTestId('bidding-panel').locator('.skeleton').first()).toBeVisible()
  } finally {
    budget.resolve()
  }
  await expect(page.getByTestId('bidding-panel')).toContainText('$37')
  await expect(page.getByTestId('place-bid-button')).toBeEnabled()
})

test('bidding retains the known balance when returning to the tab', async ({ authedPage: page, biddingLeague }) => {
  const { error } = await getAdminClient().from('team_budgets').update({ remaining_budget: 37 }).eq('team_id', biddingLeague.teamId)
  if (error) throw error
  await page.goto(`/league/${biddingLeague.id}/bidding`)
  await expect(page.getByTestId('bidding-panel')).toContainText('$37')
  const nav = page.getByTestId('league-tabs')
  await nav.getByRole('link', { name: 'Overview' }).click()
  await expect(page.getByTestId('team-header')).toBeVisible()
  const budget = deferred()
  await page.route('**/rest/v1/team_budgets?*', async (route) => {
    await budget.promise
    await route.continue()
  })
  try {
    await expectNoGlimmersDuring(page, async () => {
      await nav.getByRole('link', { name: 'Bidding' }).click()
      await expect(page.getByTestId('bidding-panel')).toContainText('$37')
      await expect(page.getByTestId('bidding-panel')).not.toContainText('$100')
    }, '[data-testid="league-tab-loading"], [data-testid="bidding-budget-loading"]')
  } finally {
    budget.resolve()
  }
})

test('an absent team budget stays unavailable and prevents spending', async ({ authedPage: page, biddingLeague }) => {
  const { error } = await getAdminClient().from('team_budgets').delete().eq('team_id', biddingLeague.teamId)
  if (error) throw error
  await page.goto(`/league/${biddingLeague.id}/bidding`)
  const panel = page.getByTestId('bidding-panel')
  await expect(panel.getByRole('alert')).toContainText('Your team budget is not available yet')
  await expect(page.getByTestId('bidding-budget')).toHaveText('—')
  await expect(page.getByTestId('bidding-budget-loading')).not.toBeVisible()
  await expect(panel).not.toContainText('$100')
  await expect(page.getByTestId('place-bid-button')).toBeDisabled()
})

test('a failed budget request shows an error and can retry the real balance', async ({ authedPage: page, biddingLeague }) => {
  const { error } = await getAdminClient().from('team_budgets').update({ remaining_budget: 37 }).eq('team_id', biddingLeague.teamId)
  if (error) throw error
  let failBudget = true
  await page.route('**/rest/v1/team_budgets?*', async (route) => {
    if (failBudget) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporarily unavailable' }),
      })
    } else {
      await route.continue()
    }
  })
  await page.goto(`/league/${biddingLeague.id}/bidding`)
  const panel = page.getByTestId('bidding-panel')
  await expect(panel.getByRole('alert')).toContainText('Could not load the latest bidding information')
  await expect(page.getByTestId('bidding-budget')).toHaveText('—')
  await expect(panel).not.toContainText('$100')
  await expect(page.getByTestId('place-bid-button')).toBeDisabled()
  failBudget = false
  await panel.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByTestId('bidding-budget')).toHaveText('$37')
  await expect(panel.getByRole('alert')).not.toBeVisible()
  await expect(page.getByTestId('place-bid-button')).toBeEnabled()
})

test('setup leagues show real budgets and leave absent balances unavailable', async ({ authedPage: page, draftReadyLeague, testUser }) => {
  const teamId = await getTeamId(draftReadyLeague.id, testUser.id)
  await createTeamBudget(teamId, 37)
  await page.goto(`/league/${draftReadyLeague.id}/dashboard`)
  await expect(page.getByTestId('team-budget')).toContainText('$37')
  const { error } = await getAdminClient().from('team_budgets').delete().eq('team_id', teamId)
  if (error) throw error
  await page.goto(`/league/${draftReadyLeague.id}/dashboard`)
  await expect(page.getByTestId('team-header')).toBeVisible()
  await expect(page.getByTestId('team-budget')).not.toBeVisible()
  const nav = page.getByTestId('league-tabs')
  await expect(nav.getByRole('link', { name: 'Bidding' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Trading' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Roster' }).click()
  await expect(page).toHaveURL(new RegExp(`/league/${draftReadyLeague.id}/roster$`))
  await expect(page.getByTestId('roster-team-name')).toBeVisible()
  await expect(page.getByTestId('league-tab-loading')).not.toBeVisible()
  await expect(page.locator('main')).not.toContainText('$100')
  await page.goto(`/league/${draftReadyLeague.id}/bidding`)
  await expect(page).toHaveURL(new RegExp(`/league/${draftReadyLeague.id}/draft$`))
  await expect(page.getByTestId('bidding-panel')).not.toBeVisible()
})
