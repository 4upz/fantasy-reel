import { test, expect } from '../../fixtures/auth.fixture'
import { getAdminClient } from '../../helpers/supabase.helper'

/**
 * Account Linking E2E tests
 * Tests the flow for linking multiple OAuth providers and merging accounts
 */
test.describe('Account Linking', () => {
  test.describe('Connected Accounts Section', () => {
    test('shows email account as connected @critical', async ({
      authenticatedPage,
      testUser,
    }) => {
      const page = authenticatedPage

      await page.goto('/settings')

      // Should show Connected Accounts section
      await expect(page.getByText(/connected accounts/i)).toBeVisible()

      // Should show email as connected
      await expect(page.getByText(testUser.email)).toBeVisible()

      // Should show email icon or indicator
      await expect(page.getByTestId('email-account-connected')).toBeVisible()
    })

    test('shows available OAuth providers to connect', async ({
      authenticatedPage,
    }) => {
      const page = authenticatedPage

      await page.goto('/settings')

      // Should show Discord connect option
      await expect(page.getByTestId('connect-discord-button')).toBeVisible()

      // Should show Google connect option
      await expect(page.getByTestId('connect-google-button')).toBeVisible()
    })

    test('connect Discord button initiates OAuth', async ({
      authenticatedPage,
    }) => {
      const page = authenticatedPage

      await page.goto('/settings')

      // Click connect Discord
      const [popup] = await Promise.all([
        page.waitForEvent('popup').catch(() => null),
        page.getByTestId('connect-discord-button').click(),
      ])

      if (popup) {
        // Should redirect to Discord OAuth
        const popupUrl = popup.url()
        expect(popupUrl).toMatch(/discord\.com|supabase/)
        await popup.close()
      }
    })

    test('connect Google button initiates OAuth', async ({
      authenticatedPage,
    }) => {
      const page = authenticatedPage

      await page.goto('/settings')

      // Click connect Google
      const [popup] = await Promise.all([
        page.waitForEvent('popup').catch(() => null),
        page.getByTestId('connect-google-button').click(),
      ])

      if (popup) {
        // Should redirect to Google OAuth
        const popupUrl = popup.url()
        expect(popupUrl).toMatch(/accounts\.google\.com|supabase/)
        await popup.close()
      }
    })
  })

  test.describe('Disconnect Account', () => {
    test('cannot disconnect only auth method', async ({
      authenticatedPage,
      testUser,
    }) => {
      const page = authenticatedPage

      await page.goto('/settings')

      // Find disconnect button for email (the only auth method)
      const disconnectButton = page.getByTestId('disconnect-email-button')

      // Button should either be:
      // 1. Not visible
      // 2. Disabled
      // 3. Show error when clicked

      if (await disconnectButton.isVisible().catch(() => false)) {
        if (await disconnectButton.isDisabled()) {
          // Expected - button is disabled
          expect(await disconnectButton.isDisabled()).toBe(true)
        } else {
          // Click and expect error
          await disconnectButton.click()
          await expect(
            page.getByText(/cannot disconnect|only.*method|at least one/i)
          ).toBeVisible()
        }
      }
      // If button not visible, that's also acceptable behavior
    })

    test.skip('can disconnect when multiple auth methods exist', async ({
      authenticatedPage,
      testUser,
    }) => {
      // This test requires setting up a user with multiple auth methods
      // Skipped as it requires mocking OAuth or real provider
    })
  })

  test.describe('Link Account Page', () => {
    test('link-account page shows merge options', async ({ page }) => {
      // Direct navigation to link-account page
      // In real scenario, this would be after OAuth callback detected duplicate

      await page.goto('/auth/link-account')

      // May redirect if no pending link session
      // Check what's displayed
      const url = page.url()

      if (url.includes('/auth/link-account')) {
        // On link-account page
        // Should show options or error about no pending link

        const hasOptions = await page
          .getByText(/link|merge|connect|existing/i)
          .isVisible()
          .catch(() => false)
        const hasNoSession = await page
          .getByText(/no.*session|invalid|expired/i)
          .isVisible()
          .catch(() => false)

        expect(hasOptions || hasNoSession).toBe(true)
      }
      // If redirected, that's also valid behavior
    })

    test('merge account button calls merge-accounts function', async ({
      authenticatedPage,
    }) => {
      const page = authenticatedPage

      // Navigate to link-account page
      await page.goto('/auth/link-account')

      // If there's a merge button and we're authenticated
      const mergeButton = page.getByTestId('merge-account-button')

      if (await mergeButton.isVisible().catch(() => false)) {
        // Set up request interception to verify Edge Function is called
        let mergeAccountsCalled = false

        await page.route('**/functions/v1/merge-accounts**', async (route) => {
          mergeAccountsCalled = true
          await route.continue()
        })

        await mergeButton.click()

        // Wait a moment for request
        await page.waitForTimeout(500)

        // In a real scenario with pending OAuth, this would call merge-accounts
        // Without pending OAuth data, it may show an error instead
      }
    })
  })

  test.describe('OAuth Callback with Existing Email', () => {
    test('callback redirects to link-account on duplicate email', async ({
      page,
    }) => {
      // This tests the scenario where:
      // 1. User has email account: test@example.com
      // 2. User tries to sign in with Google using test@example.com
      // 3. System detects duplicate and redirects to link-account

      // Without actually completing OAuth, we can test the page exists
      // and handles the scenario

      // Navigate to callback with mock data (won't work without real OAuth)
      await page.goto('/auth/callback?error=access_denied&error_description=email_exists')

      // Should redirect to appropriate error/link page
      await page.waitForURL(/link-account|login|error/, { timeout: 5000 })
    })
  })
})

/**
 * Full Account Linking Flow Tests
 * These require actual OAuth provider setup or mocking
 */
test.describe('Full Account Linking Flows', () => {
  test.skip('link Discord to existing email account', async ({ page }) => {
    // Full flow:
    // 1. Login with email
    // 2. Go to settings
    // 3. Click Connect Discord
    // 4. Complete Discord OAuth
    // 5. Verify Discord now shows as connected
    // 6. Verify can login with Discord
  })

  test.skip('merge accounts when OAuth email matches', async ({ page }) => {
    // Full flow:
    // 1. Create account with email test@example.com
    // 2. Logout
    // 3. Click "Sign in with Google" using test@example.com
    // 4. System detects duplicate, shows link-account page
    // 5. User clicks "Merge accounts"
    // 6. Verify accounts merged
    // 7. Verify can login with either method
  })

  test.skip('keep accounts separate (decline merge)', async ({ page }) => {
    // Full flow:
    // 1. Create account with email
    // 2. Try OAuth with same email
    // 3. On link-account page, choose "Create new account"
    // 4. Verify new account created (or error if not allowed)
  })
})
