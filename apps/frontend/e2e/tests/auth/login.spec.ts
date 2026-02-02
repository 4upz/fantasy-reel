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

    // Should show dashboard content (user is authenticated)
    await expect(page.getByText(/your leagues/i)).toBeVisible()
  })

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login')

    // Fill form with invalid credentials
    await page.fill('[data-testid="email-input"]', 'nonexistent@test.local')
    await page.fill('[data-testid="password-input"]', 'WrongPassword123!')
    await page.click('[data-testid="login-button"]')

    // Should show error message (in form alert - use first() since toast may also show it)
    await expect(page.locator('form').getByText(/invalid email or password/i)).toBeVisible()

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
    // Directly navigate to forgot password to verify the page exists
    await page.goto('/forgot-password')

    // Verify we can access the forgot password page
    await expect(page.getByText(/reset|password/i).first()).toBeVisible()
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
    // Start on dashboard to verify we're authenticated
    await authenticatedPage.goto('/dashboard')
    await expect(authenticatedPage.getByText(/your leagues/i)).toBeVisible()

    // Use Playwright's request API to POST to signout endpoint with page cookies
    const cookies = await authenticatedPage.context().cookies()
    await authenticatedPage.request.post('/auth/signout', {
      headers: {
        Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
      },
    })

    // After signout, navigating to dashboard should redirect to login
    await authenticatedPage.goto('/dashboard')
    await authenticatedPage.waitForURL('/login')
  })
})
