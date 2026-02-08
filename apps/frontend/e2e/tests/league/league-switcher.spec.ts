import { test, expect } from '../../fixtures/league.fixture'
import { waitForPageSettle } from '../../helpers/ui.helper'

/**
 * League Switcher E2E Tests
 *
 * Tests the LeagueSwitcher dropdown component that allows users to
 * switch between their leagues without leaving the current tab context.
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

    // Click the league name button (has aria-haspopup="listbox")
    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()

    // Verify dropdown with role="listbox" appears
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Verify "Your Leagues" header text
    await expect(authedPage.getByText('Your Leagues')).toBeVisible()
  })

  test('dropdown closes on toggle click', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })

    // Open
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Close by clicking again
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).not.toBeVisible({ timeout: 5000 })
  })

  test('dropdown closes on Escape', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Press Escape
    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByRole('listbox')).not.toBeVisible({ timeout: 5000 })
  })

  test('dropdown closes on click outside', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Click outside the dropdown
    await authedPage.locator('body').click({ position: { x: 10, y: 10 } })
    await expect(authedPage.getByRole('listbox')).not.toBeVisible({ timeout: 5000 })
  })

  test('current league is highlighted', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Current league should have aria-selected="true"
    const currentOption = authedPage.getByRole('option', { name: new RegExp(multiLeague.league1.name) })
    await expect(currentOption).toHaveAttribute('aria-selected', 'true')

    // Other league should have aria-selected="false"
    const otherOption = authedPage.getByRole('option', { name: new RegExp(multiLeague.league2.name) })
    await expect(otherOption).toHaveAttribute('aria-selected', 'false')
  })

  test('switching leagues preserves current tab', async ({ authedPage, multiLeague }) => {
    // Start on league1's standings tab
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Click league2
    const league2Option = authedPage.getByRole('option', { name: new RegExp(multiLeague.league2.name) })
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
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Click the current league option
    const currentOption = authedPage.getByRole('option', { name: new RegExp(multiLeague.league1.name) })
    await currentOption.click()

    // Dropdown should close
    await expect(authedPage.getByRole('listbox')).not.toBeVisible({ timeout: 5000 })

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
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Each league option should show its status badge
    // Use locator scoped to each option to avoid strict mode violations
    // (league names contain "Active"/"Setup" text too)
    const activeOption = authedPage.getByRole('option', { name: new RegExp(multiLeague.league1.name) })
    await expect(activeOption.locator('.badge')).toBeVisible()

    const setupOption = authedPage.getByRole('option', { name: new RegExp(multiLeague.league2.name) })
    await expect(setupOption.locator('.badge')).toBeVisible()
  })

  test('"View All Leagues" navigates to dashboard', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

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
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Should have exactly one option (testUser is only in this league)
    const options = authedPage.getByRole('option')
    await expect(options).toHaveCount(1)
  })

  test('ARIA attributes are correct', async ({ authedPage, multiLeague }) => {
    await authedPage.goto(`/league/${multiLeague.league1.id}/standings`)
    await waitForPageSettle(authedPage)

    const trigger = authedPage.getByRole('button', { name: multiLeague.league1.name })
    await expect(trigger).toBeVisible({ timeout: 10000 })

    // Button should have aria-expanded="false" when closed
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')

    // Open dropdown
    await trigger.click()

    // Button should have aria-expanded="true" when open
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Listbox should have role="listbox"
    await expect(authedPage.getByRole('listbox')).toBeVisible({ timeout: 5000 })

    // Wait for options to load (async fetch), then verify role="option"
    await expect(authedPage.getByRole('option').first()).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByRole('option')).toHaveCount(2)
  })
})
