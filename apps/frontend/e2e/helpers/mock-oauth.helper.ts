import { Page, BrowserContext, Route } from '@playwright/test'
import { createTestUser, deleteTestUser, TestUser } from './supabase.helper'
import { createClient } from '@supabase/supabase-js'

/**
 * OAuth mocking utilities for E2E tests
 *
 * Intercepts OAuth redirects at the Supabase auth URL level and simulates
 * successful authentication without requiring real provider consent.
 *
 * This follows Supabase testing best practices by:
 * - Creating test users programmatically via admin API
 * - Injecting sessions into browser context
 * - Avoiding real OAuth provider dependencies
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export type OAuthProvider = 'discord' | 'google'

interface MockOAuthResult {
  /** The created test user */
  user: TestUser
  /** Cleanup function to delete the test user */
  cleanup: () => Promise<void>
}

/**
 * Setup OAuth mocking for a page with pre-authenticated session.
 *
 * This approach:
 * 1. Creates a test user programmatically
 * 2. Gets a valid session for that user
 * 3. Injects the session into browser context BEFORE navigation
 * 4. Intercepts OAuth redirects to redirect directly to the app
 *
 * The key difference from the previous approach is that we inject the session
 * BEFORE any navigation, so when the route handler redirects to /dashboard,
 * the session is already in localStorage.
 *
 * @param page - Playwright page instance
 * @param context - Playwright browser context
 * @param provider - The OAuth provider to mock
 * @returns The created test user and cleanup function
 */
export async function mockOAuthFlow(
  page: Page,
  context: BrowserContext,
  options: { provider: OAuthProvider }
): Promise<MockOAuthResult> {
  const { provider } = options

  // Create a test user for this OAuth flow
  const testUser = await createTestUser(`oauth-${provider}`)

  // Get a session for the test user
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: authData, error } = await supabase.auth.signInWithPassword({
    email: testUser.email,
    password: testUser.password,
  })

  if (error || !authData.session) {
    // Clean up the test user if auth fails
    await deleteTestUser(testUser.id)
    throw new Error(`Failed to get session for OAuth mock: ${error?.message}`)
  }

  // Inject session into browser context BEFORE any navigation
  // This is crucial - the session must be in localStorage before the redirect
  await context.addInitScript((session) => {
    const storageKey = 'sb-127-auth-token'
    localStorage.setItem(storageKey, JSON.stringify(session))
  }, authData.session)

  // Setup route interception for OAuth redirects
  // Since session is already injected, we just need to redirect to the app
  await page.route('**/auth/v1/authorize**', async (route: Route) => {
    const url = new URL(route.request().url())
    const requestedProvider = url.searchParams.get('provider')

    if (requestedProvider === provider) {
      // Get the redirect destination from the OAuth URL, default to dashboard
      const redirectTo = url.searchParams.get('redirect_to') || '/dashboard'

      // Redirect to the app - session is already in localStorage
      await route.fulfill({
        status: 302,
        headers: {
          Location: redirectTo,
        },
      })
    } else {
      await route.continue()
    }
  })

  return {
    user: testUser,
    cleanup: async () => {
      // Unroute to prevent errors after test ends
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
      await deleteTestUser(testUser.id)
      await supabase.auth.signOut()
    },
  }
}

/**
 * Simplified OAuth redirect mock that just intercepts and blocks the redirect.
 *
 * Use this when you only need to verify:
 * - The OAuth button is clickable
 * - Clicking it initiates an OAuth flow
 *
 * Does NOT authenticate the user - the page will show an intercepted message.
 *
 * @param page - Playwright page instance
 * @returns A promise that resolves when the route is set up
 */
export async function mockOAuthRedirect(page: Page): Promise<void> {
  await page.route('**/auth/v1/authorize**', async (route: Route) => {
    const url = new URL(route.request().url())
    const provider = url.searchParams.get('provider') || 'unknown'

    // Return a simple response indicating OAuth was intercepted
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <!DOCTYPE html>
        <html>
          <head><title>OAuth Mock</title></head>
          <body>
            <h1>OAuth redirect intercepted</h1>
            <p>Provider: ${provider}</p>
          </body>
        </html>
      `,
    })
  })
}

/**
 * Create and inject an authenticated session for testing.
 *
 * Use this to quickly get an authenticated state without going through
 * any OAuth flow at all. This is the fastest approach for tests that
 * just need to be logged in.
 *
 * @param context - Playwright browser context
 * @param prefix - Prefix for the test user (default: 'inject')
 * @returns Test user and cleanup function
 */
export async function createAuthenticatedSession(
  context: BrowserContext,
  prefix: string = 'inject'
): Promise<MockOAuthResult> {
  const testUser = await createTestUser(prefix)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await supabase.auth.signInWithPassword({
    email: testUser.email,
    password: testUser.password,
  })

  if (error || !data.session) {
    await deleteTestUser(testUser.id)
    throw new Error(`Failed to get session: ${error?.message}`)
  }

  // Inject session before any navigation
  await context.addInitScript((session) => {
    const storageKey = 'sb-127-auth-token'
    localStorage.setItem(storageKey, JSON.stringify(session))
  }, data.session)

  return {
    user: testUser,
    cleanup: async () => {
      await deleteTestUser(testUser.id)
      await supabase.auth.signOut()
    },
  }
}
