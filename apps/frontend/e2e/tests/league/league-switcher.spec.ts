import { test, expect } from '../../fixtures/league.fixture'
import { waitForPageSettle } from '../../helpers/ui.helper'

/**
 * League Switcher E2E Tests
 *
 * Tests the LeagueSwitcher dropdown component that allows users to
 * switch between their leagues without leaving the current tab context.
 *
 * The switcher is a disclosure (the page's <h1> holds the trigger button)
 * opening a list of links, one per league; the current league's link carries
 * aria-current="page".
 *
 * Uses multiLeague fixture which provides two leagues:
 * - league1: active status
 * - league2: setup status
 *
 * Uses testLeague fixture for single-league scenarios.
 */

test.describe('League Switcher', () => {
  // --- P0: Critical ---

  test('dropdown opens on click', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    // Click the league name button inside the page heading
    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()

    // Verify the dropdown appears
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Verify "Your leagues" header text
    await expect(authedPage.getByText('Your leagues', { exact: true })).toBeVisible()
  })

  test('dropdown closes on toggle click', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })

    // Open
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Close by clicking again
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).not.toBeVisible({ timeout: 5000 })
  })

  test('dropdown closes on Escape', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Press Escape
    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByTestId('league-switcher-menu')).not.toBeVisible({ timeout: 5000 })
  })

  test('dropdown closes on click outside', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Click outside the dropdown
    await authedPage.locator('body').click({ position: { x: 10, y: 10 } })
    await expect(authedPage.getByTestId('league-switcher-menu')).not.toBeVisible({ timeout: 5000 })
  })

  test('current league is highlighted', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Current league's link should be marked as the current page
    const leagueList = authedPage.getByTestId('league-switcher-menu').getByRole('list')
    const currentOption = leagueList.getByRole('link', { name: new RegExp(multiLeague.league1.name) })
    await expect(currentOption).toHaveAttribute('aria-current', 'page')

    // Other league should not be
    const otherOption = leagueList.getByRole('link', { name: new RegExp(multiLeague.league2.name) })
    await expect(otherOption).not.toHaveAttribute('aria-current', /.*/)
  })

  test('switching leagues preserves current tab', async ({ authedPage, multiLeague }) => {
    // Start on league1's standings tab
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Click league2
    const league2Option = authedPage.getByTestId('league-switcher-menu').getByRole('list')
      .getByRole('link', { name: new RegExp(multiLeague.league2.name) })
    await league2Option.click()

    // Wait for navigation and verify URL preserves /standings tab
    await authedPage.waitForURL(new RegExp(`/league/${multiLeague.league2.id}/standings`), { timeout: 10000 })
  })

  test('clicking current league closes dropdown without navigation', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Click the current league's link
    const currentOption = authedPage.getByTestId('league-switcher-menu').getByRole('list')
      .getByRole('link', { name: new RegExp(multiLeague.league1.name) })
    await currentOption.click()

    // Dropdown should close
    await expect(authedPage.getByTestId('league-switcher-menu')).not.toBeVisible({ timeout: 5000 })

    // URL should remain unchanged
    expect(authedPage.url()).toContain(`/league/${multiLeague.league1.id}/standings`)
  })

  // --- P1: Important ---

  test('status badges are visible for each league', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Each league option should show its status badge
    // Use locator scoped to each option to avoid strict mode violations
    // (league names contain "Active"/"Setup" text too)
    const leagueList = authedPage.getByTestId('league-switcher-menu').getByRole('list')
    const activeOption = leagueList.getByRole('link', { name: new RegExp(multiLeague.league1.name) })
    await expect(activeOption.locator('.badge')).toBeVisible()

    const setupOption = leagueList.getByRole('link', { name: new RegExp(multiLeague.league2.name) })
    await expect(setupOption.locator('.badge')).toBeVisible()
  })

  test('"View All Leagues" navigates to dashboard', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Click "View All Leagues" link
    await authedPage.getByRole('link', { name: /view all leagues/i }).click()

    // Should navigate to dashboard
    await authedPage.waitForURL('/dashboard', { timeout: 10000 })
  })

  // --- P2: Nice to Have ---

  test('single-league user sees one entry', async ({ authedPage, activeLeague }) => {
    // activeLeague adds testUser as a participant, so authedPage can access it
    await authedPage.goto(`/league/${activeLeague.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: activeLeague.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByTestId('league-switcher-menu')).toBeVisible({ timeout: 5000 })

    // Should have exactly one league link (testUser is only in this league)
    const options = authedPage.getByTestId('league-switcher-menu').getByRole('list').getByRole('link')
    await expect(options).toHaveCount(1)
  })

  test('ARIA attributes are correct', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })

    // The league name is the page's heading; its button is a disclosure
    await expect(authedPage.getByRole('heading', { level: 1, name: multiLeague.league1.name })).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Open dropdown
    await trigger.click()

    // Button should have aria-expanded="true" and point at the menu when open
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = authedPage.getByTestId('league-switcher-menu')
    await expect(menu).toBeVisible({ timeout: 5000 })
    await expect(trigger).toHaveAttribute('aria-controls', (await menu.getAttribute('id'))!)

    // Wait for the leagues to load (async fetch): one link each, in a list
    const links = menu.getByRole('list', { name: 'Your leagues' }).getByRole('link')
    await expect(links.first()).toBeVisible({ timeout: 5000 })
    await expect(links).toHaveCount(2)
  })
})
