import { test as base, Page, BrowserContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  createTestUser,
  deleteTestUser,
  TestUser,
  getAdminClient,
} from '../helpers/supabase.helper'

/**
 * Supabase E2E Testing Best Practices Applied:
 *
 * 1. PROGRAMMATIC AUTH - Use Supabase auth.signInWithPassword() to get session,
 *    then inject into browser context. Much faster than UI login for non-auth tests.
 *
 * 2. SERVICE ROLE FOR SETUP - Use service role key for test data creation/cleanup
 *    (bypasses RLS), but test the actual app with user's JWT (respects RLS).
 *
 * 3. ISOLATED CONTEXTS - Each test gets fresh browser context with its own session.
 *
 * 4. PROPER CLEANUP - Fixtures ensure cleanup runs even if test fails.
 *
 * 5. STORAGE STATE - Save authenticated state to reuse across tests in same worker.
 *
 * References:
 * - https://github.com/isaacharrisholt/supawright
 * - https://fireship.io/courses/supabase/setup-playwright/
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface AuthFixtures {
  /** A test user (auto-created and cleaned up) */
  testUser: TestUser
  /** A second test user for multi-user tests */
  secondUser: TestUser
  /** A test user designated as league owner */
  leagueOwner: TestUser
  /** A page that's already logged in as testUser (via UI - for testing auth flow) */
  authenticatedPage: Page
  /** A page with programmatic auth (faster - for non-auth tests) */
  authedPage: Page
  /** Browser context with programmatic auth */
  authedContext: BrowserContext
  /** Browser context authenticated as secondUser (for multi-user tests) */
  secondUserContext: BrowserContext
  /** A page authenticated as secondUser (for multi-user tests like trading, outbidding) */
  secondUserPage: Page
}

export const test = base.extend<AuthFixtures>({
  // Create primary test user
  testUser: async ({}, use) => {
    const user = await createTestUser('primary')
    await use(user)
    await deleteTestUser(user.id)
  },

  // Create secondary test user for multi-user scenarios
  secondUser: async ({}, use) => {
    const user = await createTestUser('secondary')
    await use(user)
    await deleteTestUser(user.id)
  },

  // Create league owner user
  leagueOwner: async ({}, use) => {
    const user = await createTestUser('owner')
    await use(user)
    await deleteTestUser(user.id)
  },

  // Provide a page that's already authenticated as testUser via UI
  // Use this when you need to test the actual login flow
  authenticatedPage: async ({ page, testUser }, use) => {
    await loginAs(page, testUser)
    await use(page)
  },

  /**
   * Provide a page with programmatic authentication (FASTER)
   * Use this for tests that don't need to verify the login UI
   *
   * This follows Supabase best practices:
   * - Sign in programmatically via Supabase client
   * - Inject session cookies into browser context
   * - App sees authenticated user without going through login UI
   */
  authedContext: async ({ browser, testUser }, use) => {
    // Create authenticated session via Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: testUser.email,
      password: testUser.password,
    })

    if (error || !data.session) {
      throw new Error(`Failed to authenticate test user: ${error?.message}`)
    }

    // Create new browser context
    const context = await browser.newContext()

    // Inject Supabase auth cookies/storage
    // Supabase stores session in localStorage with key pattern: sb-<project-ref>-auth-token
    await context.addInitScript((session) => {
      // Store session in localStorage (Supabase client will pick this up)
      const storageKey = `sb-127-auth-token` // Local Supabase uses '127' as project ref
      localStorage.setItem(storageKey, JSON.stringify(session))
    }, data.session)

    await use(context)

    // Cleanup: close context and sign out
    await context.close()
    await supabase.auth.signOut()
  },

  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()
    await use(page)
  },

  /**
   * Browser context authenticated as secondUser
   * For multi-user tests like trading, outbidding, real-time updates
   */
  secondUserContext: async ({ browser, secondUser }, use) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: secondUser.email,
      password: secondUser.password,
    })

    if (error || !data.session) {
      throw new Error(`Failed to authenticate second user: ${error?.message}`)
    }

    const context = await browser.newContext()

    await context.addInitScript((session) => {
      const storageKey = `sb-127-auth-token`
      localStorage.setItem(storageKey, JSON.stringify(session))
    }, data.session)

    await use(context)

    await context.close()
    await supabase.auth.signOut()
  },

  /**
   * Page authenticated as secondUser
   * Use for multi-user scenarios: User A does action -> User B sees result
   */
  secondUserPage: async ({ secondUserContext }, use) => {
    const page = await secondUserContext.newPage()
    await use(page)
  },
})

/**
 * Login as a specific user via the UI
 * Use this when testing the actual authentication flow
 *
 * For faster tests that don't need to verify login UI, use `authedPage` fixture instead.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')

  // Fill login form
  await page.fill('[data-testid="email-input"]', user.email)
  await page.fill('[data-testid="password-input"]', user.password)
  await page.click('[data-testid="login-button"]')

  // Wait for redirect to dashboard
  await page.waitForURL('/dashboard', { timeout: 10000 })
}

/**
 * Login programmatically and set session in page context
 * Faster than UI login - use for tests that don't need to verify login flow
 */
export async function loginProgrammatically(
  page: Page,
  user: TestUser
): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })

  if (error || !data.session) {
    throw new Error(`Failed to authenticate: ${error?.message}`)
  }

  // Inject session into page's localStorage before navigating
  await page.addInitScript((session) => {
    const storageKey = `sb-127-auth-token`
    localStorage.setItem(storageKey, JSON.stringify(session))
  }, data.session)

  // Navigate to app - should be authenticated
  await page.goto('/dashboard')

  // Verify we're authenticated
  await page.waitForURL('/dashboard', { timeout: 10000 })
}

/**
 * Logout the current user
 */
export async function logout(page: Page): Promise<void> {
  // Click user menu and sign out
  await page.click('[data-testid="user-menu-button"]')
  await page.click('[data-testid="signout-button"]')
  await page.waitForURL('/login')
}

/**
 * Get an authenticated Supabase client for a test user
 * Use this to verify RLS policies work correctly
 *
 * Example:
 *   const userClient = await getAuthenticatedClient(testUser)
 *   const { data } = await userClient.from('leagues').select()
 *   // This respects RLS - user only sees their leagues
 */
export async function getAuthenticatedClient(user: TestUser) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })

  if (error) {
    throw new Error(`Failed to get authenticated client: ${error.message}`)
  }

  return supabase
}

/**
 * Verify RLS policy by testing that user can/cannot access data
 * Use admin client to create data, user client to verify access
 *
 * Example:
 *   await verifyRLS({
 *     setup: async (admin) => {
 *       await admin.from('leagues').insert({ ... })
 *     },
 *     test: async (userClient) => {
 *       const { data } = await userClient.from('leagues').select()
 *       expect(data).toHaveLength(0) // User shouldn't see other's leagues
 *     },
 *     user: testUser,
 *   })
 */
export async function verifyRLS(options: {
  setup: (adminClient: ReturnType<typeof getAdminClient>) => Promise<void>
  test: (userClient: Awaited<ReturnType<typeof getAuthenticatedClient>>) => Promise<void>
  user: TestUser
  cleanup?: (adminClient: ReturnType<typeof getAdminClient>) => Promise<void>
}) {
  const admin = getAdminClient()
  const userClient = await getAuthenticatedClient(options.user)

  try {
    await options.setup(admin)
    await options.test(userClient)
  } finally {
    if (options.cleanup) {
      await options.cleanup(admin)
    }
  }
}

// Re-export expect for convenience
export { expect } from '@playwright/test'
