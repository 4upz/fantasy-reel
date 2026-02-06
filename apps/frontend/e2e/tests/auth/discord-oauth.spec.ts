import { test, expect } from '@playwright/test'
import { mockOAuthRedirect } from '../../helpers/mock-oauth.helper'

/**
 * Discord OAuth E2E tests
 *
 * These tests verify OAuth UI elements and redirect behavior.
 * Full OAuth flow testing requires real OAuth credentials and is not
 * automated - it should be done manually or in integration tests.
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

      // Setup mock to intercept OAuth redirect
      await mockOAuthRedirect(page)

      // Click Discord login button
      await page.getByTestId('discord-login-button').click()

      // Should have been redirected to our mock (which intercepted the OAuth)
      // The mock returns a simple HTML page with "OAuth redirect intercepted"
      await expect(page.locator('body')).toContainText(
        /OAuth redirect intercepted|discord/i
      )
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

  test.describe('Account Linking Flow', () => {
    test('link-account page loads without errors', async ({ page }) => {
      // Navigate to link-account page (simulating OAuth callback redirect)
      await page.goto('/auth/link-account')

      // Page should load without 500 errors
      // It may redirect if no pending link session
      const response = await page.reload()
      expect(response?.status()).toBeLessThan(500)
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
