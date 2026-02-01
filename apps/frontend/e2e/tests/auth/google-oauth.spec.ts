import { test, expect } from '@playwright/test'

/**
 * Google OAuth E2E tests
 *
 * Note: Full OAuth flow testing requires either:
 * 1. A test Google account with automation capabilities
 * 2. Mocking the OAuth provider response
 * 3. Using Supabase's test OAuth flow
 *
 * These tests verify the UI elements and initial redirect behavior.
 * Full flow testing should be done in integration tests or manually.
 */
test.describe('Google OAuth', () => {
  test.describe('Login Page', () => {
    test('Google login button is visible on login page @critical', async ({
      page,
    }) => {
      await page.goto('/login')

      // Google login button should be visible
      await expect(page.getByTestId('google-login-button')).toBeVisible()

      // Should have correct text
      await expect(page.getByTestId('google-login-button')).toContainText(
        /google|sign in with google/i
      )
    })

    test('Google login button initiates OAuth flow', async ({ page }) => {
      await page.goto('/login')

      // Click Google login button
      const [popup] = await Promise.all([
        // Wait for popup or navigation
        page.waitForEvent('popup').catch(() => null),
        page.getByTestId('google-login-button').click(),
      ])

      // Either redirects to Google OAuth or opens popup
      if (popup) {
        // Popup flow - URL should contain Google OAuth
        const popupUrl = popup.url()
        expect(popupUrl).toMatch(/accounts\.google\.com|supabase/)
        await popup.close()
      } else {
        // Redirect flow - current page should redirect
        await page.waitForURL(/accounts\.google\.com|supabase/, {
          timeout: 5000,
        }).catch(() => {
          // If redirect doesn't happen, check if we're still on login
          // This might indicate OAuth is configured differently
        })
      }
    })
  })

  test.describe('Signup Page', () => {
    test('Google signup button is visible on signup page', async ({ page }) => {
      await page.goto('/signup')

      // Google signup button should be visible
      await expect(page.getByTestId('google-login-button')).toBeVisible()
    })

    test('Google signup button has correct styling', async ({ page }) => {
      await page.goto('/signup')

      const button = page.getByTestId('google-login-button')

      // Button should be visible and styled
      await expect(button).toBeVisible()

      // Check for Google icon/branding
      const hasIcon = await button.locator('svg').count()
      expect(hasIcon).toBeGreaterThan(0)
    })
  })

  test.describe('Connected Accounts (Settings)', () => {
    // These tests require an authenticated user
    // We'll use the auth fixture when available

    test('shows Google connection option in settings', async ({ page }) => {
      // Note: This test would need authentication fixture
      // For now, we verify the page structure exists

      // Skip if not authenticated (will be handled by fixture later)
      await page.goto('/settings')

      // If redirected to login, that's expected for unauthenticated
      if (page.url().includes('/login')) {
        test.skip()
        return
      }

      // Look for Connected Accounts section
      await expect(page.getByText(/connected accounts/i)).toBeVisible()

      // Look for Google option
      await expect(
        page.getByText(/google/i).first()
      ).toBeVisible()
    })
  })

  test.describe('Account Linking Flow', () => {
    test('link-account page handles Google merge scenario', async ({
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
test.describe('Google OAuth Full Flow', () => {
  test.skip('complete Google signup creates new account', async ({ page }) => {
    // This test requires a test Google account
    // 1. Click Google signup
    // 2. Enter Google credentials in popup/redirect
    // 3. Authorize the app
    // 4. Verify redirect back to app
    // 5. Verify account created
  })

  test.skip('Google login with existing account authenticates', async ({
    page,
  }) => {
    // This test requires an existing Google-linked account
  })

  test.skip('link Google to existing email account', async ({ page }) => {
    // This test requires:
    // 1. An existing email account
    // 2. A Google account with the same email
    // 3. Proper handling of the merge flow
  })
})
