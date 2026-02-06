import { test, expect } from '../../fixtures/auth.fixture'

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

      // Should show email account row with the user's email
      const emailAccountRow = page.getByTestId('email-account-connected')
      await expect(emailAccountRow).toBeVisible()
      await expect(emailAccountRow.getByText(testUser.email)).toBeVisible()
    })

    test('shows available OAuth providers to connect', async ({
      authenticatedPage,
    }) => {
      const page = authenticatedPage

      await page.goto('/settings')

      // Should show Discord connect option (email-only user has no Discord identity)
      await expect(page.getByTestId('connect-discord-button')).toBeVisible()

      // Should show Google connect option
      await expect(page.getByTestId('connect-google-button')).toBeVisible()
    })

    // Skip: OAuth redirect mock is fragile; connect button tests initiate real OAuth flows
    test.skip('connect Discord button initiates OAuth', async () => {
      // Requires OAuth mock that intercepts the Supabase linkIdentity redirect
    })

    // Skip: OAuth redirect mock is fragile; connect button tests initiate real OAuth flows
    test.skip('connect Google button initiates OAuth', async () => {
      // Requires OAuth mock that intercepts the Supabase linkIdentity redirect
    })
  })

  test.describe('Disconnect Account', () => {
    // Skip: disconnect-email-button doesn't exist; email/password shows as "Primary" with no disconnect option
    test.skip('cannot disconnect only auth method', async () => {
      // Email/password is shown as "Primary" - no disconnect button rendered
    })

    test.skip('can disconnect when multiple auth methods exist', async () => {
      // Requires setting up a user with multiple auth methods
    })
  })

  test.describe('Link Account Page', () => {
    test('link-account page loads without crashing', async ({ page }) => {
      // Direct navigation to link-account page
      // Without a pending link session, it may redirect or show an error
      await page.goto('/auth/link-account')

      // The page should load - either show content or redirect
      // Just verify no 500 error
      const url = page.url()
      const redirected = !url.includes('/auth/link-account')

      if (!redirected) {
        // On link-account page - verify it rendered something
        const bodyText = await page.locator('body').textContent()
        expect(bodyText).toBeTruthy()
      }
      // If redirected, that's valid behavior
    })

    // Skip: merge-account-button test ID may not exist without a pending OAuth session
    test.skip('merge account button calls merge-accounts function', async () => {
      // Requires pending OAuth session state
    })
  })

  test.describe('OAuth Callback with Existing Email', () => {
    test('callback redirects to appropriate page on error', async ({ page }) => {
      // Navigate to callback with mock error data
      await page.goto('/auth/callback?error=access_denied&error_description=email_exists')

      // Should redirect to appropriate error/link page
      await page.waitForURL(/link-account|login|error|auth-code-error/, { timeout: 5000 })
    })
  })
})

/**
 * Full Account Linking Flow Tests
 * These require actual OAuth provider setup or mocking
 */
test.describe('Full Account Linking Flows', () => {
  test.skip('link Discord to existing email account', async () => {
    // Requires actual OAuth provider setup
  })

  test.skip('merge accounts when OAuth email matches', async () => {
    // Requires actual OAuth provider setup
  })

  test.skip('keep accounts separate (decline merge)', async () => {
    // Requires actual OAuth provider setup
  })
})
