import { test, expect } from '../../fixtures/league.fixture'
import { waitForPageSettle } from '../../helpers/ui.helper'

/**
 * League Tabs Navigation E2E Tests
 *
 * Tests the horizontal tab navigation (LeagueTabs) inside the league layout.
 * Tabs: Overview, Standings, Draft, Bidding, Trading, Roster, Settings (owner only)
 *
 * Fixtures used:
 * - activeLeague: active-status league with testUser as non-owner participant
 * - draftReadyLeague: setup-status league with testUser as participant
 * - authedPage: page authenticated as testUser (non-owner)
 */

test.describe('League Tabs Navigation', () => {
  test.describe('P0 - Critical', () => {
    test('tabs render on league page @critical', async ({ authedPage, activeLeague }) => {
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      // Verify tab navigation container exists
      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Verify core tab names are visible
      await expect(tabNav.getByText('Overview')).toBeVisible()
      await expect(tabNav.getByText('Standings')).toBeVisible()
      await expect(tabNav.getByText('Draft')).toBeVisible()
      await expect(tabNav.getByText('Roster')).toBeVisible()
    })

    test('clicking a tab navigates to correct page @critical', async ({
      authedPage,
      activeLeague,
    }) => {
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Click Draft tab and verify URL
      await tabNav.getByRole('link', { name: 'Draft' }).click()
      await authedPage.waitForURL(`**/league/${activeLeague.id}/draft`)
      expect(authedPage.url()).toContain(`/league/${activeLeague.id}/draft`)

      // Click Roster tab and verify URL
      await tabNav.getByRole('link', { name: 'Roster' }).click()
      await authedPage.waitForURL(`**/league/${activeLeague.id}/roster`)
      expect(authedPage.url()).toContain(`/league/${activeLeague.id}/roster`)
    })

    test('active tab is highlighted with aria-current @critical', async ({
      authedPage,
      activeLeague,
    }) => {
      // On dashboard, Overview tab should be active
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      const overviewTab = tabNav.getByRole('link', { name: 'Overview' })
      await expect(overviewTab).toHaveAttribute('aria-current', 'page')

      // Navigate to Draft, verify Draft tab is active and Overview is not
      await tabNav.getByRole('link', { name: 'Draft' }).click()
      await authedPage.waitForURL(`**/league/${activeLeague.id}/draft`)

      const draftTab = tabNav.getByRole('link', { name: 'Draft' })
      await expect(draftTab).toHaveAttribute('aria-current', 'page')
      await expect(overviewTab).not.toHaveAttribute('aria-current', 'page')
    })
  })

  test.describe('P1 - Important', () => {
    test('disabled tabs for pre-active leagues', async ({
      authedPage,
      draftReadyLeague,
    }) => {
      await authedPage.goto(`/league/${draftReadyLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Standings, Bidding, and Trading should be disabled (rendered as spans, not links)
      const standingsTab = tabNav.getByRole('link', { name: 'Standings' })
      const biddingTab = tabNav.getByRole('link', { name: 'Bidding' })
      const tradingTab = tabNav.getByRole('link', { name: 'Trading' })

      // Disabled tabs are <span role="link" aria-disabled="true">, not <a> links
      // They should have aria-disabled="true"
      await expect(standingsTab).toHaveAttribute('aria-disabled', 'true')
      await expect(biddingTab).toHaveAttribute('aria-disabled', 'true')
      await expect(tradingTab).toHaveAttribute('aria-disabled', 'true')

      // Overview and Draft should still be clickable links (not disabled)
      const overviewTab = tabNav.getByRole('link', { name: 'Overview' })
      await expect(overviewTab).not.toHaveAttribute('aria-disabled', 'true')
    })

    test('settings tab not visible for non-owner', async ({
      authedPage,
      activeLeague,
    }) => {
      // authedPage is logged in as testUser, who is NOT the league owner
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Settings tab should NOT be visible for non-owner
      await expect(tabNav.getByText('Settings')).not.toBeVisible()
    })

    // Skip: No ownerPage fixture available to test owner seeing Settings tab
    test.skip('settings tab visible for owner', async () => {
      // Would need a page authenticated as leagueOwner to verify
      // Settings tab is visible. Current fixtures only provide
      // authedPage (testUser) and secondUserPage (secondUser).
    })

    test('tab navigation preserves league context', async ({
      authedPage,
      activeLeague,
    }) => {
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Click through multiple tabs and verify league ID stays the same
      await tabNav.getByRole('link', { name: 'Draft' }).click()
      await authedPage.waitForURL(`**/league/${activeLeague.id}/draft`)
      expect(authedPage.url()).toContain(`/league/${activeLeague.id}`)

      await tabNav.getByRole('link', { name: 'Roster' }).click()
      await authedPage.waitForURL(`**/league/${activeLeague.id}/roster`)
      expect(authedPage.url()).toContain(`/league/${activeLeague.id}`)

      await tabNav.getByRole('link', { name: 'Overview' }).click()
      await authedPage.waitForURL(`**/league/${activeLeague.id}/dashboard`)
      expect(authedPage.url()).toContain(`/league/${activeLeague.id}`)
    })
  })

  test.describe('P2 - Nice to have', () => {
    test('all tabs render for active league', async ({
      authedPage,
      activeLeague,
    }) => {
      // authedPage is testUser (non-owner), so Settings tab won't appear
      // This test verifies the 6 non-owner tabs render for an active league
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // All 6 non-owner tabs should be visible and enabled (not disabled)
      const expectedTabs = ['Overview', 'Standings', 'Draft', 'Bidding', 'Trading', 'Roster']
      for (const tabName of expectedTabs) {
        await expect(tabNav.getByText(tabName)).toBeVisible()
      }

      // None should be disabled for an active league
      const standingsLink = tabNav.getByRole('link', { name: 'Standings' })
      await expect(standingsLink).not.toHaveAttribute('aria-disabled', 'true')

      const biddingLink = tabNav.getByRole('link', { name: 'Bidding' })
      await expect(biddingLink).not.toHaveAttribute('aria-disabled', 'true')

      const tradingLink = tabNav.getByRole('link', { name: 'Trading' })
      await expect(tradingLink).not.toHaveAttribute('aria-disabled', 'true')
    })
  })
})
