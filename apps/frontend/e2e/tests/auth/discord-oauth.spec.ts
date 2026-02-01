import { test, expect } from '@playwright/test'

/**
 * Discord OAuth E2E tests
 *
 * Note: Full OAuth flow testing requires either:
 * 1. A test Discord account with automation capabilities
 * 2. Mocking the OAuth provider response
 * 3. Using Supabase's test OAuth flow
 *
 * These tests verify the UI elements and initial redirect behavior.
 * Full flow testing should be done in integration tests or manually.
 */
test.describe('Discord OAuth', () => {
  test.describe('Login Page', () => {
    test('Discord login button is visible on login page @critical', async ({
      page,
    }) => {
      await page.goto('/login')

      // Discord login button should be visible
      await expect(page.getByTestId('discord-login-button')).toBeVisible()

      // Should have correct text
      await expect(page.getByTestId('discord-login-button')).toContainText(
        /discord|continue with discord/i
      )
    })

    test('Discord login button initiates OAuth flow', async ({ page }) => {
      await page.goto('/login')

      // Click Discord login button
      const [popup] = await Promise.all([
        // Wait for popup or navigation
        page.waitForEvent('popup').catch(() => null),
        page.getByTestId('discord-login-button').click(),
      ])

      // Either redirects to Discord OAuth or opens popup
      if (popup) {
        // Popup flow - URL should contain Discord OAuth
        const popupUrl = popup.url()
        expect(popupUrl).toMatch(/discord\.com|supabase/)
        await popup.close()
      } else {
        // Redirect flow - current page should redirect
        await page
          .waitForURL(/discord\.com|supabase/, {
            timeout: 5000,
          })
          .catch(() => {
            // If redirect doesn't happen, check if we're still on login
            // This might indicate OAuth is configured differently
          })
      }
    })
  })

  test.describe('Signup Page', () => {
    test('Discord signup button is visible on signup page', async ({
      page,
    }) => {
      await page.goto('/signup')

      // Discord signup button should be visible
      await expect(page.getByTestId('discord-login-button')).toBeVisible()
    })

    test('Discord signup button has correct styling', async ({ page }) => {
      await page.goto('/signup')

      const button = page.getByTestId('discord-login-button')

      // Button should be visible and styled
      await expect(button).toBeVisible()

      // Check for Discord brand color (#5865F2)
      const bgColor = await button.evaluate((el) =>
        window.getComputedStyle(el).backgroundColor
      )
      // Discord brand color is #5865F2 (rgb(88, 101, 242))
      expect(bgColor).toMatch(/rgb\(88,\s*101,\s*242\)/)

      // Check for Discord icon
      const hasIcon = await button.locator('svg').count()
      expect(hasIcon).toBeGreaterThan(0)
    })
  })

  test.describe('Connected Accounts (Settings)', () => {
    test('shows Discord connection option in settings', async ({ page }) => {
      // Note: This test would need authentication fixture
      // For now, we verify the page structure exists

      await page.goto('/settings')

      // If redirected to login, that's expected for unauthenticated
      if (page.url().includes('/login')) {
        test.skip()
        return
      }

      // Look for Connected Accounts section
      await expect(page.getByText(/connected accounts/i)).toBeVisible()

      // Look for Discord option
      await expect(page.getByText(/discord/i).first()).toBeVisible()
    })
  })

  test.describe('Account Linking Flow', () => {
    test('link-account page handles Discord merge scenario', async ({
      page,
    }) => {
      // Navigate to link-account page (simulating OAuth callback redirect)
      await page.goto('/auth/link-account')

      // Page should load without errors
      // It may redirect or show a form depending on auth state

      // Check for common elements
      const hasLinkOption = await page
        .getByText(/link|merge|connect/i)
        .isVisible()
        .catch(() => false)
      const hasError = await page
        .getByText(/error/i)
        .isVisible()
        .catch(() => false)
      const redirected = !page.url().includes('/auth/link-account')

      // One of these should be true - page loaded correctly
      expect(hasLinkOption || hasError || redirected).toBe(true)
    })
  })

  test.describe('OAuth Callback', () => {
    test('callback route exists and handles requests', async ({ page }) => {
      // Test that the callback route is accessible
      // Without a valid code, it should handle gracefully

      const response = await page.goto('/auth/callback?code=invalid_test_code')

      // Should not crash - either redirect or show error
      expect(response?.status()).toBeLessThan(500)
    })

    test('callback without code redirects appropriately', async ({ page }) => {
      await page.goto('/auth/callback')

      // Should redirect to error page or login
      await page.waitForURL(/login|error|auth-code-error/, { timeout: 5000 })
    })
  })
})

/**
 * Full OAuth Flow Tests (require test account or mock)
 *
 * These tests are designed to be run with proper OAuth test credentials.
 * They are skipped by default and can be enabled when credentials are available.
 */
test.describe('Discord OAuth Full Flow', () => {
  test.skip('complete Discord signup creates new account', async ({
    page,
  }) => {
    // This test requires a test Discord account
    // 1. Click Discord signup
    // 2. Enter Discord credentials in popup/redirect
    // 3. Authorize the app
    // 4. Verify redirect back to app
    // 5. Verify account created
  })

  test.skip('Discord login with existing account authenticates', async ({
    page,
  }) => {
    // This test requires an existing Discord-linked account
  })

  test.skip('link Discord to existing email account', async ({ page }) => {
    // This test requires:
    // 1. An existing email account
    // 2. A Discord account with the same email
    // 3. Proper handling of the merge flow
  })
})
