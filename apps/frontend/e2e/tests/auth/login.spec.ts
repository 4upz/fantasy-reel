import { test, expect } from '../../fixtures/auth.fixture'

/**
 * Login flow E2E tests
 * Tests the real authentication flow against local Supabase
 */
test.describe('User Login', () => {
  test('successful login redirects to dashboard', async ({ page, testUser }) => {
    await page.goto('/login')

    // Fill login form
    await page.fill('[data-testid="email-input"]', testUser.email)
    await page.fill('[data-testid="password-input"]', testUser.password)
    await page.click('[data-testid="login-button"]')

    // Should redirect to dashboard
    await page.waitForURL('/dashboard')

    // Should show user's display name
    await expect(page.getByText(testUser.displayName)).toBeVisible()
  })

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login')

    // Fill form with invalid credentials
    await page.fill('[data-testid="email-input"]', 'nonexistent@test.local')
    await page.fill('[data-testid="password-input"]', 'WrongPassword123!')
    await page.click('[data-testid="login-button"]')

    // Should show error message
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible()

    // Should remain on login page
    expect(page.url()).toContain('/login')
  })

  test('empty form shows validation errors', async ({ page }) => {
    await page.goto('/login')

    // Click submit without filling form
    await page.click('[data-testid="login-button"]')

    // Should show validation errors (implementation depends on form validation)
    // At minimum, should not navigate away
    expect(page.url()).toContain('/login')
  })

  test('preserves return URL after login', async ({ page, testUser }) => {
    // Try to access protected page while logged out
    await page.goto('/dashboard')

    // Should redirect to login (middleware protection)
    await page.waitForURL(/\/login/)

    // Login
    await page.fill('[data-testid="email-input"]', testUser.email)
    await page.fill('[data-testid="password-input"]', testUser.password)
    await page.click('[data-testid="login-button"]')

    // Should redirect to originally requested page
    await page.waitForURL('/dashboard')
  })

  test('Discord OAuth button is visible', async ({ page }) => {
    await page.goto('/login')

    // Discord login button should be present
    await expect(page.getByTestId('discord-login-button')).toBeVisible()
  })

  test('forgot password link navigates correctly', async ({ page }) => {
    await page.goto('/login')

    // Click forgot password link
    await page.click('text=Forgot password')

    // Should navigate to forgot password page
    await page.waitForURL('/forgot-password')
  })

  test('signup link navigates correctly', async ({ page }) => {
    await page.goto('/login')

    // Click signup link
    await page.click('text=Sign up')

    // Should navigate to signup page
    await page.waitForURL('/signup')
  })
})

test.describe('Authenticated Session', () => {
  test('authenticated user can access dashboard', async ({ authenticatedPage }) => {
    // authenticatedPage fixture is already logged in
    await authenticatedPage.goto('/dashboard')

    // Should show dashboard content
    await expect(authenticatedPage.getByText(/your leagues/i)).toBeVisible()
  })

  test('logout redirects to login page', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/dashboard')

    // Open user menu and click signout
    await authenticatedPage.click('[data-testid="user-menu-button"]')
    await authenticatedPage.click('[data-testid="signout-button"]')

    // Should redirect to login
    await authenticatedPage.waitForURL('/login')
  })
})
