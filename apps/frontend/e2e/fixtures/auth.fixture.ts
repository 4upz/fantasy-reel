import { test as base, Page } from '@playwright/test'
import {
  createTestUser,
  deleteTestUser,
  TestUser,
} from '../helpers/supabase.helper'

/**
 * Extended Playwright test with authentication fixtures
 * Provides pre-authenticated users and pages for tests
 */

interface AuthFixtures {
  /** A test user (auto-created and cleaned up) */
  testUser: TestUser
  /** A second test user for multi-user tests */
  secondUser: TestUser
  /** A test user designated as league owner */
  leagueOwner: TestUser
  /** A page that's already logged in as testUser */
  authenticatedPage: Page
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

  // Provide a page that's already authenticated as testUser
  authenticatedPage: async ({ page, testUser }, use) => {
    await loginAs(page, testUser)
    await use(page)
  },
})

/**
 * Login as a specific user via the UI
 * This tests the real authentication flow
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
 * Logout the current user
 */
export async function logout(page: Page): Promise<void> {
  // Click user menu and sign out
  await page.click('[data-testid="user-menu-button"]')
  await page.click('[data-testid="signout-button"]')
  await page.waitForURL('/login')
}

// Re-export expect for convenience
export { expect } from '@playwright/test'
