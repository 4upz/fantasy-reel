import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'
import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { getRunId } from './e2e/helpers/test-ids.helper'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '.env.local') })

process.env.E2E_RUN_ID ||= randomUUID()
const runId = getRunId() // Reject unsafe cleanup identifiers before launching workers.
const e2eDistDir = `.next-e2e/${runId}`
const e2eTsconfig = `tsconfig.e2e.${runId}.json`

if (!process.env.CI) {
  // Next adds its generated-type include to its configured tsconfig. Give each
  // test server its own root-level config so normal development stays untouched.
  const config = {
    extends: './tsconfig.json',
    compilerOptions: { tsBuildInfoFile: `${e2eDistDir}/cache/tsconfig.tsbuildinfo` },
    // TypeScript's broad globs skip hidden directories; explicitly include only
    // this run's generated types, and omit the normal .next types from the base.
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', `${e2eDistDir}/types/**/*.ts`],
    exclude: ['node_modules', '.next'],
  }
  try {
    writeFileSync(path.resolve(__dirname, e2eTsconfig), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' })
  } catch (error) {
    // Config is loaded again in every worker; never rewrite it while Next reads it.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

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

/**
 * Where the suite points. Defaults to a dedicated :3100 server owned by this run.
 * Set E2E_BASE_URL to select another local port.
 */
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3100'

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
    // Overridable so a git worktree can test its OWN server. With this
    // hardcoded, `reuseExistingServer` silently attaches to whatever is already
    // on :3000 -- normally the main checkout -- and the suite passes or fails
    // against code that is not the branch under test.
    baseURL: E2E_BASE_URL,

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
     * - Scope all data to this run
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
      testIgnore: /mobile-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    {
      name: 'mobile-chrome',
      testMatch: /mobile-smoke\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
      dependencies: ['setup'],
    },
  ],

  /**
   * Web Server Configuration
   *
   * In CI: serve the production build (`next start`). The workflow runs
   * `next build` first. A dev server compiles every route on first hit,
   * and parallel workers hitting an uncompiled app on a small runner is
   * what caused the 30s navigation timeouts and 22-28 min suite runs.
   * Locally: start a fresh server so tests always exercise this checkout.
   */
  webServer: {
    // Local runs use plain `next dev` (webpack), not `npm run dev`
    // (--turbopack): the Sentry SDK doesn't support Turbopack until Next
    // 15.4.1, and running the E2E suite against that combination degrades
    // the dev server app-wide. Revert after upgrading Next past 15.4.1.
    command: `${process.env.CI ? 'npx next start' : 'npx next dev'} --port ${new URL(E2E_BASE_URL).port || '80'}`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 120 * 1000, // 2 minutes to start

    // Environment variables for the server
    env: {
      // Ensure we're using local Supabase
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
      ...(!process.env.CI ? { E2E_DIST_DIR: e2eDistDir, E2E_TSCONFIG: e2eTsconfig } : {}),
    },
  },
})
