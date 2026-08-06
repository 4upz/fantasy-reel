import { test as base, Page, BrowserContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  createTestUser,
  deleteTestUser,
  TestUser,
  getAdminClient,
} from '../helpers/supabase.helper'
import { setWorkerIndex, getWorkerPrefix } from '../helpers/test-ids.helper'

/**
 * Supabase E2E Testing Best Practices Applied:
 *
 * 1. UI-BASED AUTH - Use UI login to authenticate browser contexts. This ensures
 *    proper cookie setup for Supabase SSR middleware (which reads cookies, not localStorage).
 *
 * 2. SERVICE ROLE FOR SETUP - Use service role key for test data creation/cleanup
 *    (bypasses RLS), but test the actual app with user's JWT (respects RLS).
 *
 * 3. ISOLATED CONTEXTS - Each test gets fresh browser context with its own session.
 *
 * 4. PROPER CLEANUP - Fixtures ensure cleanup runs even if test fails.
 *
 * 5. WORKER-SCOPED DATA - Use unique IDs per worker to avoid parallel test collisions.
 *
 * Why UI Login Instead of Programmatic Session Injection:
 * - Supabase SSR middleware (Next.js) reads auth from cookies, not localStorage
 * - Manual localStorage injection doesn't set the cookies the middleware expects
 * - UI login through the browser's Supabase client properly sets both
 * - While slightly slower, this is the reliable approach for SSR apps
 *
 * References:
 * - https://playwright.dev/docs/auth
 * - https://www.bekapod.dev/articles/supabase-magic-login-testing-with-playwright/
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface AuthFixtures {
  /** Internal fixture that initializes worker index - runs automatically */
  _workerInit: void
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
  /** Browser context authenticated as leagueOwner */
  leagueOwnerContext: BrowserContext
  /** A page authenticated as leagueOwner (for owner-only features like settings) */
  leagueOwnerPage: Page
}

export const test = base.extend<AuthFixtures>({
  /**
   * Auto fixture that initializes worker index early in test setup.
   * This ensures all fixtures (not just testUser) get proper worker isolation.
   * Without this, tests using only draftReadyLeague would get workerIndex=0.
   */
  _workerInit: [async ({}, use, testInfo) => {
    setWorkerIndex(testInfo.parallelIndex)
    await use(undefined)
  }, { auto: true }],

  // Create primary test user
  testUser: async ({ _workerInit }, use) => {
    const user = await createTestUser('primary')
    await use(user)
    await deleteTestUser(user.id)
  },

  // Create secondary test user for multi-user scenarios
  secondUser: async ({ _workerInit }, use) => {
    const user = await createTestUser('secondary')
    await use(user)
    await deleteTestUser(user.id)
  },

  // Create league owner user
  leagueOwner: async ({ _workerInit }, use) => {
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
   * Provide a browser context with authenticated session
   *
   * This uses UI login to ensure proper cookie setup for Supabase SSR:
   * - The browser's Supabase client handles auth and sets cookies correctly
   * - Server-side middleware (which reads cookies) sees the authenticated user
   * - More reliable than manual localStorage injection which doesn't work with SSR
   *
   * Note: While slightly slower than pure programmatic auth, this approach
   * is necessary because Supabase SSR middleware reads auth from cookies,
   * not localStorage. The UI login properly sets both.
   *
   * References:
   * - https://playwright.dev/docs/auth
   * - https://www.bekapod.dev/articles/supabase-magic-login-testing-with-playwright/
   */
  authedContext: async ({ browser, testUser }, use) => {
    // Create new browser context
    const context = await browser.newContext()
    const page = await context.newPage()

    // Login via UI - this ensures the browser's Supabase client
    // properly sets cookies that the server middleware can read
    await loginAs(page, testUser)

    // Close the login page but keep the authenticated context
    await page.close()

    await use(context)

    // Cleanup: close context
    await context.close()
  },

  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()
    await use(page)
  },

  /**
   * Browser context authenticated as secondUser
   * For multi-user tests like trading, outbidding, real-time updates
   *
   * Uses UI login for proper cookie setup (same as authedContext)
   */
  secondUserContext: async ({ browser, secondUser }, use) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    // Login via UI for proper cookie setup
    await loginAs(page, secondUser)

    // Close the login page but keep the authenticated context
    await page.close()

    await use(context)

    await context.close()
  },

  /**
   * Page authenticated as secondUser
   * Use for multi-user scenarios: User A does action -> User B sees result
   */
  secondUserPage: async ({ secondUserContext }, use) => {
    const page = await secondUserContext.newPage()
    await use(page)
  },

  /**
   * Browser context authenticated as leagueOwner
   * For owner-only tests like settings pages, draft order management
   *
   * Uses UI login for proper cookie setup (same as authedContext)
   */
  leagueOwnerContext: async ({ browser, leagueOwner }, use) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await loginAs(page, leagueOwner)

    await page.close()

    await use(context)

    await context.close()
  },

  /**
   * Page authenticated as leagueOwner
   * Use for testing owner-only features like league settings, draft order
   */
  leagueOwnerPage: async ({ leagueOwnerContext }, use) => {
    const page = await leagueOwnerContext.newPage()
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

  // Wait for redirect to dashboard. 30s matches the config's navigationTimeout:
  // in CI the dev server compiles routes on first hit, and early tests routinely
  // exceed 10s on the cold /login → /dashboard path.
  await page.waitForURL('/dashboard', { timeout: 30000 })
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

/**
 * Clean up worker-specific test data.
 * Call this in afterEach hooks to remove data created by this worker.
 *
 * Uses worker prefix to identify and delete only this worker's test data.
 */
export async function cleanupWorkerData(): Promise<void> {
  const client = getAdminClient()
  const workerPrefix = getWorkerPrefix()

  try {
    // Delete test leagues created by this worker (cascades to participants, teams, etc.)
    await client.from('leagues').delete().like('name', `%${workerPrefix}%`)

    // Delete test users created by this worker
    const { data: usersData } = await client.auth.admin.listUsers()
    const workerUsers =
      usersData?.users.filter((u) =>
        u.email?.includes(`-${workerPrefix}-`)
      ) || []

    for (const user of workerUsers) {
      await client.auth.admin.deleteUser(user.id)
    }
  } catch (error) {
    // Log but don't fail - cleanup is best-effort
    console.warn(`Worker ${workerPrefix} cleanup warning:`, error)
  }
}

// Re-export expect for convenience
export { expect } from '@playwright/test'
