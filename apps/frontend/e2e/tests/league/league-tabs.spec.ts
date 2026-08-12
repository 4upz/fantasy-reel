import { test, expect } from '../../fixtures/league.fixture'
import { waitForPageSettle } from '../../helpers/ui.helper'

/**
 * League Tabs Navigation E2E Tests
 *
 * Tests the horizontal tab navigation (LeagueTabs) inside the league layout, plus
 * the bottom bar (LeagueBottomNav) that replaces it below `lg`.
 * Tabs: Overview, Standings, Draft, Bidding, Trading, Roster, Settings (owner only)
 *
 * Draft is demoted once a league reaches active/completed: still reachable, but it
 * leaves the primary tab run and the mobile bottom bar. See leagueNav.ts.
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
    test('hides post-draft tabs for pre-active leagues', async ({
      authedPage,
      draftReadyLeague,
    }) => {
      await authedPage.goto(`/league/${draftReadyLeague.id}/draft`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Standings, Bidding, and Trading should NOT be visible (hidden entirely)
      await expect(tabNav.getByText('Standings')).not.toBeVisible()
      await expect(tabNav.getByText('Bidding')).not.toBeVisible()
      await expect(tabNav.getByText('Trading')).not.toBeVisible()

      // Overview, Draft, and Roster should be visible as links
      await expect(tabNav.getByRole('link', { name: 'Overview' })).toBeVisible()
      await expect(tabNav.getByRole('link', { name: 'Draft' })).toBeVisible()
      await expect(tabNav.getByRole('link', { name: 'Roster' })).toBeVisible()

      // Verify tab count: Overview, Draft, Roster = 3 links (testUser is not owner, so no Settings)
      await expect(tabNav.getByRole('link')).toHaveCount(3)
    })

    test('draft is demoted to a secondary link for active leagues', async ({
      authedPage,
      activeLeague,
    }) => {
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // Still reachable, but rendered outside the primary tab run
      const secondary = tabNav.locator('[data-testid="league-tab-secondary"]')
      await expect(secondary).toHaveCount(1)
      await expect(secondary).toHaveText('Draft')
      await expect(secondary).toHaveAttribute('href', `/league/${activeLeague.id}/draft`)
    })

    test('draft stays a primary tab before the season starts', async ({
      authedPage,
      draftReadyLeague,
    }) => {
      await authedPage.goto(`/league/${draftReadyLeague.id}/draft`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      await expect(tabNav.locator('[data-testid="league-tab-secondary"]')).toHaveCount(0)
      await expect(tabNav.getByRole('link', { name: 'Draft' })).toHaveAttribute('aria-current', 'page')
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
      await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
      await waitForPageSettle(authedPage)

      const tabNav = authedPage.locator('[data-testid="league-tabs"]')
      await expect(tabNav).toBeVisible({ timeout: 10000 })

      // All 6 non-owner tabs should be visible as clickable links
      const expectedTabs = ['Overview', 'Standings', 'Draft', 'Bidding', 'Trading', 'Roster']
      for (const tabName of expectedTabs) {
        await expect(tabNav.getByRole('link', { name: tabName })).toBeVisible()
      }

      // Verify tab count: 6 links for non-owner
      await expect(tabNav.getByRole('link')).toHaveCount(6)
    })
  })
})

test.describe('League Bottom Nav (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('active league puts Roster on the bar and Draft in the More sheet', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)
    await waitForPageSettle(authedPage)

    const bottomNav = authedPage.locator('[data-testid="league-bottom-nav"]')
    await expect(bottomNav).toBeVisible({ timeout: 10000 })

    // Roster takes the slot Draft used to hold during the season
    await expect(bottomNav.getByRole('link', { name: 'Roster' })).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: 'Draft' })).toHaveCount(0)

    // Draft is one tap away rather than gone
    await bottomNav.getByRole('button', { name: 'More' }).click()

    const sheet = authedPage.getByRole('dialog', { name: 'More league pages' })
    await expect(sheet).toBeVisible()

    const draftLink = sheet.getByRole('link', { name: 'Draft' })
    await expect(draftLink).toBeVisible()
    await draftLink.click()
    await authedPage.waitForURL(`**/league/${activeLeague.id}/draft`)
  })

  test('pre-active league keeps Draft on the bar', async ({
    authedPage,
    draftReadyLeague,
  }) => {
    await authedPage.goto(`/league/${draftReadyLeague.id}/dashboard`)
    await waitForPageSettle(authedPage)

    const bottomNav = authedPage.locator('[data-testid="league-bottom-nav"]')
    await expect(bottomNav).toBeVisible({ timeout: 10000 })

    await expect(bottomNav.getByRole('link', { name: 'Draft' })).toBeVisible()
  })
})
