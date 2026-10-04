import { test, expect } from '../../fixtures/auth.fixture'

/**
 * Smoke tests for critical user paths
 *
 * These tests verify the most essential user journeys work end-to-end.
 * Run before every deployment to ensure core functionality is intact.
 *
 * Tag: @critical @smoke
 */

test.describe('Critical Path: Authentication @critical @smoke', () => {
  test('user can login and access dashboard', async ({ page, testUser }) => {
    // Navigate to login
    await page.goto('/login')
    await expect(page).toHaveTitle(/Fantasy Reel/)

    // Complete login flow
    await page.getByTestId('email-input').fill(testUser.email)
    await page.getByTestId('password-input').fill(testUser.password)
    await page.getByTestId('login-button').click()

    // Verify successful authentication
    await page.waitForURL('/dashboard')
    await expect(page.getByText(/your leagues/i)).toBeVisible({ timeout: 10000 })
  })

  test('user can logout successfully', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/dashboard')
    await expect(authenticatedPage.getByText(/your leagues/i)).toBeVisible()

    // Logout via direct POST to signout endpoint (sidebar is collapsed by default)
    await authenticatedPage.request.post('/auth/signout')

    // After signout, navigating to dashboard should redirect to login
    await authenticatedPage.goto('/dashboard')
    await authenticatedPage.waitForURL('/login')
  })
})

test.describe('Critical Path: League Creation @critical @smoke', () => {
  test('authenticated user can create a new league', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto('/dashboard')

    // Click create league button (or "Create Your First League" in empty state)
    const createButton = authenticatedPage.getByRole('button', { name: 'Create your first league', exact: true })
    await expect(createButton).toBeVisible({ timeout: 10000 })
    await createButton.click()

    // Wait for modal to appear
    await expect(authenticatedPage.getByRole('dialog')).toBeVisible()

    // Fill league creation form
    await authenticatedPage.getByTestId('league-name-input').fill('Smoke Test League')

    // Submit the form
    await authenticatedPage.getByTestId('create-league-submit').click()

    // Verify navigation to league page
    await authenticatedPage.waitForURL(/\/league\/[a-f0-9-]+/)

    // Verify league page loaded (shows Setup status for new league)
    await expect(authenticatedPage.getByText('Setup').first()).toBeVisible({
      timeout: 10000,
    })
  })
})

test.describe('Critical Path: Navigation @critical @smoke', () => {
  test('unauthenticated user is redirected from protected routes', async ({
    page,
  }) => {
    // Try to access dashboard without auth
    await page.goto('/dashboard')

    // Should redirect to login
    await page.waitForURL(/\/login/)
  })

  for (const { name, path, testId } of [
    { name: 'Privacy policy', path: '/privacy', testId: 'footer-privacy-link' },
    { name: 'Terms of service', path: '/terms', testId: 'footer-terms-link' },
  ]) {
    test(`unauthenticated user can open the ${name.toLowerCase()} from the footer`, async ({ page }) => {
      await page.goto('/')
      await page.getByTestId(testId).click()

      // Public page: no redirect to login
      await page.waitForURL(path)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    })
  }

  for (const [where, testId] of [
    ['the home page', 'landing-discord-bot-link'],
    ['the header', 'marketing-discord-bot-link'],
    ['the footer', 'footer-discord-bot-link'],
  ]) {
    test(`unauthenticated user can open the Discord bot guide from ${where}`, async ({ page }) => {
      await page.goto('/')
      await page.getByTestId(testId).click()

      await page.waitForURL('/how-to-play#discord')
      await expect(page.getByRole('heading', { level: 2, name: 'Discord bot' })).toBeVisible()
    })
  }

  test('login page loads without errors', async ({ page }) => {
    await page.goto('/login')

    // Verify key elements are present
    await expect(page.getByTestId('email-input')).toBeVisible()
    await expect(page.getByTestId('password-input')).toBeVisible()
    await expect(page.getByTestId('login-button')).toBeVisible()
    await expect(page.getByTestId('discord-login-button')).toBeVisible()
    await expect(page.getByTestId('legal-notice')).toBeVisible()
  })

  test('signup page loads without errors', async ({ page }) => {
    await page.goto('/signup')

    // Verify key elements are present
    await expect(page.getByTestId('display-name-input')).toBeVisible()
    await expect(page.getByTestId('email-input')).toBeVisible()
    await expect(page.getByTestId('password-input')).toBeVisible()
    await expect(page.getByTestId('signup-button')).toBeVisible()
    await expect(page.getByTestId('legal-notice')).toBeVisible()
  })
})

test.describe('Critical Path: Draft (Owner Flow) @critical @smoke', () => {
  test('league owner can access draft page and see draft board', async ({
    authenticatedPage,
  }) => {
    // First create a league
    await authenticatedPage.goto('/dashboard')

    const createButton = authenticatedPage.getByRole('button', { name: 'Create your first league', exact: true })
    await expect(createButton).toBeVisible({ timeout: 10000 })
    await createButton.click()

    // Wait for modal
    await expect(authenticatedPage.getByRole('dialog')).toBeVisible()

    await authenticatedPage.getByTestId('league-name-input').fill('Draft Test League')
    await authenticatedPage.getByTestId('create-league-submit').click()

    // Wait for league page
    await authenticatedPage.waitForURL(/\/league\/[a-f0-9-]+/)

    // Extract league ID from URL and navigate to draft page directly
    const url = authenticatedPage.url()
    const leagueId = url.match(/\/league\/([a-f0-9-]+)/)?.[1]
    await authenticatedPage.goto(`/league/${leagueId}/draft`)

    // Verify draft board is visible (in setup state for new league)
    await expect(authenticatedPage.getByRole('heading', { name: 'Draft board', exact: true })).toBeVisible({ timeout: 10000 })

    // Start draft button should be visible for owner
    await expect(authenticatedPage.getByRole('button', { name: /start draft/i })).toBeVisible()
  })
})
