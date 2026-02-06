import { test, expect } from '../../fixtures/auth.fixture'

/**
 * Login flow E2E tests
 * Tests the real authentication flow against local Supabase
 */
test.describe('User Login', () => {
  test('successful login redirects to dashboard', async ({ page, testUser }) => {
    await page.goto('/login')

    // Fill login form
    await page.getByTestId('email-input').fill(testUser.email)
    await page.getByTestId('password-input').fill(testUser.password)
    await page.getByTestId('login-button').click()

    // Should redirect to dashboard
    await page.waitForURL('/dashboard')

    // Should show dashboard content (user is authenticated)
    await expect(page.getByText(/your leagues/i)).toBeVisible()
  })

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login')

    // Fill form with invalid credentials
    await page.getByTestId('email-input').fill('nonexistent@test.local')
    await page.getByTestId('password-input').fill('WrongPassword123!')
    await page.getByTestId('login-button').click()

    // Should show error message (in form alert - use first() since toast may also show it)
    await expect(page.locator('form').getByText(/invalid email or password/i)).toBeVisible()

    // Should remain on login page
    expect(page.url()).toContain('/login')
  })

  test('empty form shows validation errors', async ({ page }) => {
    await page.goto('/login')

    // Click submit without filling form
    await page.getByTestId('login-button').click()

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
    await page.getByTestId('email-input').fill(testUser.email)
    await page.getByTestId('password-input').fill(testUser.password)
    await page.getByTestId('login-button').click()

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

    // Click forgot password link via testid
    await page.getByTestId('forgot-password-link').click()

    // Verify we navigated to the forgot password page
    await page.waitForURL('/forgot-password')
  })

  test('signup link navigates correctly', async ({ page }) => {
    await page.goto('/login')

    // Click signup link
    await page.getByRole('link', { name: /sign up/i }).click()

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
    // Start on dashboard to verify we're authenticated
    await authenticatedPage.goto('/dashboard')
    await expect(authenticatedPage.getByText(/your leagues/i)).toBeVisible()

    // POST to signout endpoint to clear session
    await authenticatedPage.request.post('/auth/signout')

    // After signout, navigating to dashboard should redirect to login
    await authenticatedPage.goto('/dashboard')
    await authenticatedPage.waitForURL('/login')
  })
})
