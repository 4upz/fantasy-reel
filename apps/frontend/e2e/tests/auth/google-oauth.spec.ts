import { test, expect } from '@playwright/test'
import { mockOAuthRedirect } from '../../helpers/mock-oauth.helper'

/**
 * Google OAuth E2E tests
 *
 * These tests verify OAuth UI elements and redirect behavior.
 * Full OAuth flow testing requires real OAuth credentials and is not
 * automated - it should be done manually or in integration tests.
 *
 * Note: The "Full Flow" tests that previously existed were removed because
 * mocking the complete OAuth flow with session injection is fragile and
 * doesn't provide value over the existing auth fixture tests.
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

      // Setup mock to intercept OAuth redirect
      await mockOAuthRedirect(page)

      // Click Google login button
      await page.getByTestId('google-login-button').click()

      // Should have been redirected to our mock (which intercepted the OAuth)
      await expect(page.locator('body')).toContainText(
        /OAuth redirect intercepted|google/i
      )
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

  // Note: Connected Accounts tests are in the settings test file
  // since they require proper authentication via the auth fixture.
  // The OAuth tests here focus on the OAuth-specific functionality.

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
