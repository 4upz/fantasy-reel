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
    await page.fill('[data-testid="email-input"]', testUser.email)
    await page.fill('[data-testid="password-input"]', testUser.password)
    await page.click('[data-testid="login-button"]')

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
    const createButton = authenticatedPage.getByRole('button', {
      name: /create.*league/i,
    })
    await expect(createButton.first()).toBeVisible()
    await createButton.first().click()

    // Fill league creation form
    await authenticatedPage.fill('[data-testid="league-name-input"]', 'Smoke Test League')
    await authenticatedPage.fill(
      '[data-testid="team-name-input"]',
      'Smoke Test Team'
    )

    // Submit the form
    await authenticatedPage.click('[data-testid="create-league-submit"]')

    // Verify navigation to league page
    await authenticatedPage.waitForURL(/\/league\/[a-f0-9-]+/)

    // Verify league page loaded (shows draft board)
    await expect(authenticatedPage.getByText(/draft board/i)).toBeVisible({
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

  test('login page loads without errors', async ({ page }) => {
    await page.goto('/login')

    // Verify key elements are present
    await expect(page.getByTestId('email-input')).toBeVisible()
    await expect(page.getByTestId('password-input')).toBeVisible()
    await expect(page.getByTestId('login-button')).toBeVisible()
    await expect(page.getByTestId('discord-login-button')).toBeVisible()
  })

  test('signup page loads without errors', async ({ page }) => {
    await page.goto('/signup')

    // Verify key elements are present
    await expect(page.getByTestId('display-name-input')).toBeVisible()
    await expect(page.getByTestId('email-input')).toBeVisible()
    await expect(page.getByTestId('password-input')).toBeVisible()
    await expect(page.getByTestId('signup-button')).toBeVisible()
  })
})

test.describe('Critical Path: Draft (Owner Flow) @critical @smoke', () => {
  test('league owner can access draft page and see draft board', async ({
    authenticatedPage,
  }) => {
    // First create a league
    await authenticatedPage.goto('/dashboard')

    const createButton = authenticatedPage.getByRole('button', {
      name: /create.*league/i,
    })
    await createButton.first().click()

    await authenticatedPage.fill('[data-testid="league-name-input"]', 'Draft Test League')
    await authenticatedPage.click('[data-testid="create-league-submit"]')

    // Wait for league page
    await authenticatedPage.waitForURL(/\/league\/[a-f0-9-]+/)

    // Extract league ID from URL and navigate to draft page directly
    const url = authenticatedPage.url()
    const leagueId = url.match(/\/league\/([a-f0-9-]+)/)?.[1]
    await authenticatedPage.goto(`/league/${leagueId}/draft`)

    // Verify draft board is visible (in setup state for new league)
    await expect(authenticatedPage.getByText('Draft Board')).toBeVisible({ timeout: 10000 })

    // Start draft button should be visible for owner
    await expect(authenticatedPage.getByRole('button', { name: /start draft/i })).toBeVisible()
  })
})
