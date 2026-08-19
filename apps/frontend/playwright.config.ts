import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '.env.local') })

/**
 * E2E Test Configuration for Fantasy Reel
 *
 * Supabase Best Practices Applied:
 * - Global setup/teardown for database management
 * - Test isolation with fresh browser contexts
 * - Proper timeout handling for async Supabase operations
 * - Network interception support for external API mocking
 *
 * See: docs/E2E_TESTING_STRATEGY.md for full strategy details
 *
 * References:
 * - https://github.com/isaacharrisholt/supawright
 * - https://fireship.io/courses/supabase/setup-playwright/
 */
export default defineConfig({
  testDir: './e2e/tests',

  /**
   * Run tests in parallel for speed, but be aware:
   * - Each test should create its own test data
   * - Use unique identifiers (timestamps, UUIDs) to avoid conflicts
   * - Cleanup should be per-test, not global
   */
  fullyParallel: true,

  // Fail CI if test.only is accidentally committed
  forbidOnly: !!process.env.CI,

  // Retry failed tests to handle flakiness from parallel database operations
  retries: process.env.CI ? 2 : 1,

  // Limit workers in CI to avoid resource contention with Supabase
  workers: process.env.CI ? 4 : undefined,

  // Timeout for each test (Supabase operations can be slow)
  timeout: 60 * 1000, // 60 seconds per test

  // Timeout for expect() assertions
  expect: {
    timeout: 10 * 1000, // 10 seconds for assertions
  },

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  use: {
    baseURL: 'http://localhost:3000',

    // Capture trace on first retry for debugging. Traces include a
    // screencast, so separate video recording is disabled below.
    trace: 'on-first-retry',

    // Capture screenshots on failure
    screenshot: 'only-on-failure',

    // No standalone video: recording every test slowed workers down, and
    // retained failure videos exhausted the CI artifact storage quota
    // (which then failed otherwise-green runs). Traces cover debugging.
    video: 'off',

    /**
     * Action timeout - time to wait for click(), fill(), etc.
     * Supabase real-time subscriptions can take a moment to connect
     */
    actionTimeout: 15 * 1000,

    /**
     * Navigation timeout - time to wait for page.goto()
     * Allow extra time for Supabase auth middleware
     */
    navigationTimeout: 30 * 1000,
  },

  projects: [
    /**
     * Global Setup Project
     * Runs before all tests to:
     * - Verify Supabase connection
     * - Clean up stale test data
     * - Seed required test data (movies)
     */
    {
      name: 'setup',
      testDir: './e2e',
      testMatch: /global-setup\.ts/,
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testDir: './e2e',
      testMatch: /global-teardown\.ts/,
    },

    /**
     * Chromium - Primary browser
     * Default for local development and CI
     */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    // Additional browsers - run with --project flag explicitly
    // e.g., npx playwright test --project=firefox
    //
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    //   dependencies: ['setup'],
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    //   dependencies: ['setup'],
    // },
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    //   dependencies: ['setup'],
    // },
  ],

  /**
   * Web Server Configuration
   *
   * In CI: serve the production build (`next start`). The workflow runs
   * `next build` first. A dev server compiles every route on first hit,
   * and parallel workers hitting an uncompiled app on a small runner is
   * what caused the 30s navigation timeouts and 22-28 min suite runs.
   * Locally: reuse an already-running dev server (faster iteration).
   */
  webServer: {
    // Local runs use plain `next dev` (webpack), not `npm run dev`
    // (--turbopack): the Sentry SDK doesn't support Turbopack until Next
    // 15.4.1, and running the E2E suite against that combination degrades
    // the dev server app-wide. Revert after upgrading Next past 15.4.1.
    command: process.env.CI ? 'npx next start' : 'npx next dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes to start

    // Environment variables for the server
    env: {
      // Ensure we're using local Supabase
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    },
  },
})
