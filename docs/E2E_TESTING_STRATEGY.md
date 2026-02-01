# E2E Testing Strategy for Fantasy Reel

This document outlines a comprehensive end-to-end testing strategy for the Fantasy Reel frontend application, ensuring critical user journeys are verified before deployment.

---

## Executive Summary

**Problem:** Commits are shipped without verification that core user journeys work as expected.

**Solution:** Implement Playwright-based E2E tests that run against a local Supabase instance, testing real production flows with minimal mocking.

**Philosophy:** Test the application as users experience it. Only mock external third-party APIs (TMDb, OMDb) that are outside our control. Never mock Supabase—let RLS policies, Edge Functions, and real-time subscriptions execute as they would in production.

---

## 1. Technology Choice: Playwright

### Why Playwright?

| Criteria | Playwright | Cypress |
|----------|------------|---------|
| **Multi-browser** | Chromium, Firefox, WebKit | Primarily Chrome |
| **Multi-tab/context** | Native support | Limited |
| **Parallelization** | Built-in | Requires paid tier |
| **Next.js integration** | Official support | Community plugins |
| **Network interception** | Route-level control | cy.intercept |
| **Real-time testing** | WebSocket support | Limited |
| **CI performance** | Fast, isolated contexts | Slower startup |

**Recommendation:** Playwright for its superior multi-user scenario support (critical for draft/trading tests), native parallelization, and excellent Next.js integration.

---

## 2. Test Architecture

### Directory Structure

```
apps/frontend/
├── e2e/
│   ├── fixtures/
│   │   ├── auth.fixture.ts         # Authenticated user fixtures
│   │   ├── league.fixture.ts       # League setup fixtures
│   │   └── test-data.ts            # Shared test data constants
│   │
│   ├── pages/                      # Page Object Models
│   │   ├── login.page.ts
│   │   ├── signup.page.ts
│   │   ├── dashboard.page.ts
│   │   ├── league-settings.page.ts
│   │   ├── draft.page.ts
│   │   ├── bidding.page.ts
│   │   ├── trading.page.ts
│   │   ├── roster.page.ts
│   │   └── standings.page.ts
│   │
│   ├── helpers/
│   │   ├── supabase.helper.ts      # Direct DB setup/teardown
│   │   ├── auth.helper.ts          # Auth utilities
│   │   └── mock-api.helper.ts      # TMDb/OMDb mock setup
│   │
│   ├── tests/
│   │   ├── auth/
│   │   │   ├── signup.spec.ts
│   │   │   ├── login.spec.ts
│   │   │   ├── password-reset.spec.ts
│   │   │   └── discord-oauth.spec.ts
│   │   │
│   │   ├── league/
│   │   │   ├── create-league.spec.ts
│   │   │   ├── join-league.spec.ts
│   │   │   ├── league-settings.spec.ts
│   │   │   └── delete-league.spec.ts
│   │   │
│   │   ├── draft/
│   │   │   ├── draft-setup.spec.ts
│   │   │   ├── draft-flow.spec.ts
│   │   │   ├── draft-realtime.spec.ts
│   │   │   └── counterpick.spec.ts
│   │   │
│   │   ├── bidding/
│   │   │   ├── place-bid.spec.ts
│   │   │   ├── outbid-flow.spec.ts
│   │   │   └── bid-processing.spec.ts
│   │   │
│   │   ├── trading/
│   │   │   ├── propose-trade.spec.ts
│   │   │   ├── respond-trade.spec.ts
│   │   │   ├── counter-trade.spec.ts
│   │   │   └── veto-trade.spec.ts
│   │   │
│   │   ├── roster/
│   │   │   ├── view-roster.spec.ts
│   │   │   └── drop-movie.spec.ts
│   │   │
│   │   └── standings/
│   │       ├── leaderboard.spec.ts
│   │       └── score-updates.spec.ts
│   │
│   └── global-setup.ts             # Database seeding, server start
│
├── playwright.config.ts
└── package.json                    # Test scripts
```

### Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Setup project runs first - seeds database
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },

    // Auth-dependent tests
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },

    // Mobile viewport
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      dependencies: ['setup'],
    },
  ],

  // Start local dev server before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
```

---

## 3. Mocking Strategy

### What to Mock (External APIs Only)

| Service | Mock? | Reason |
|---------|-------|--------|
| **TMDb API** | ✅ Yes | External rate limits, non-deterministic data |
| **OMDb API** | ✅ Yes | External API, score data should be controlled |
| **Resend Email** | ✅ Yes | Can't verify real emails in tests |
| **Discord OAuth** | ✅ Yes | Requires real Discord account |
| **Supabase Auth** | ❌ No | Test real auth flows |
| **Supabase DB** | ❌ No | Test real RLS policies |
| **Edge Functions** | ❌ No | Test real business logic |
| **Realtime** | ❌ No | Test real subscriptions |

### Mock Implementation

```typescript
// e2e/helpers/mock-api.helper.ts
import { Page, Route } from '@playwright/test'

export const MOCK_MOVIES = [
  {
    id: 12345,
    title: 'Test Movie Alpha',
    release_date: '2025-06-15',
    poster_path: '/test-poster-alpha.jpg',
    overview: 'A test movie for E2E testing',
    vote_average: 7.5,
  },
  {
    id: 12346,
    title: 'Test Movie Beta',
    release_date: '2025-07-20',
    poster_path: '/test-poster-beta.jpg',
    overview: 'Another test movie',
    vote_average: 8.2,
  },
  // Add more as needed for draft tests
]

export async function mockTMDbAPI(page: Page) {
  // Mock browse-movies Edge Function (which calls TMDb)
  await page.route('**/functions/v1/browse-movies**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: MOCK_MOVIES,
        page: 1,
        total_pages: 1,
        total_results: MOCK_MOVIES.length,
      }),
    })
  })

  // Mock search-movies Edge Function
  await page.route('**/functions/v1/search-movies**', async (route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get('query')?.toLowerCase() || ''

    const filtered = MOCK_MOVIES.filter(m =>
      m.title.toLowerCase().includes(query)
    )

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: filtered,
        page: 1,
        total_pages: 1,
        total_results: filtered.length,
      }),
    })
  })

  // Mock get-movie-details Edge Function
  await page.route('**/functions/v1/get-movie-details**', async (route) => {
    const url = new URL(route.request().url())
    const tmdbId = parseInt(url.searchParams.get('tmdb_id') || '0')
    const movie = MOCK_MOVIES.find(m => m.id === tmdbId)

    if (movie) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(movie),
      })
    } else {
      await route.fulfill({ status: 404 })
    }
  })
}

export async function mockOMDbAPI(page: Page) {
  // Mock update-scores Edge Function responses
  await page.route('**/functions/v1/update-scores**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updated: 5, errors: 0 }),
    })
  })
}

// For email verification tests
export async function mockEmailService(page: Page) {
  // Emails go through Supabase which uses Inbucket in local dev
  // No mocking needed - we can read from Inbucket API
}
```

### Reading Test Emails (Local Supabase)

Local Supabase uses Inbucket for email capture:

```typescript
// e2e/helpers/email.helper.ts
const INBUCKET_URL = 'http://127.0.0.1:54324'

export async function getLatestEmail(email: string): Promise<{
  subject: string
  body: string
  links: string[]
}> {
  const mailbox = email.split('@')[0]

  // Get mailbox messages
  const listRes = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailbox}`)
  const messages = await listRes.json()

  if (messages.length === 0) {
    throw new Error(`No emails found for ${email}`)
  }

  // Get latest message
  const latest = messages[messages.length - 1]
  const msgRes = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailbox}/${latest.id}`)
  const message = await msgRes.json()

  // Extract links from body
  const linkRegex = /https?:\/\/[^\s<>"]+/g
  const links = message.body.text?.match(linkRegex) || []

  return {
    subject: message.subject,
    body: message.body.text || message.body.html,
    links,
  }
}

export async function clearMailbox(email: string): Promise<void> {
  const mailbox = email.split('@')[0]
  await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailbox}`, {
    method: 'DELETE',
  })
}
```

---

## 4. Supabase E2E Best Practices

Based on community patterns and official recommendations, we follow these Supabase-specific best practices:

### 4.1 Service Role vs User Authentication

| Client | Use Case | RLS |
|--------|----------|-----|
| **Service Role** | Test setup/teardown, seeding data | Bypassed |
| **User JWT** | Actual test execution | Enforced |

```typescript
// Setup: Use service role to create test data (bypasses RLS)
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
await admin.from('leagues').insert({ ... })

// Test: Use user's JWT to verify RLS works
const userClient = await getAuthenticatedClient(testUser)
const { data } = await userClient.from('leagues').select()
// User should only see their leagues
```

### 4.2 Programmatic Authentication (Faster Tests)

For tests that don't verify login UI, skip the UI and inject session directly:

```typescript
// SLOW: Login via UI for every test
await page.goto('/login')
await page.fill('[data-testid="email-input"]', email)
await page.fill('[data-testid="password-input"]', password)
await page.click('[data-testid="login-button"]')

// FAST: Inject session programmatically
const { data } = await supabase.auth.signInWithPassword({ email, password })
await page.addInitScript((session) => {
  localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
}, data.session)
await page.goto('/dashboard') // Already authenticated!
```

### 4.3 Test Isolation

Each test should:
1. Create its own test data with unique identifiers (timestamps/UUIDs)
2. Clean up after itself via fixture teardown
3. Not depend on data from other tests

```typescript
// Good: Fixture creates and cleans up
testUser: async ({}, use) => {
  const user = await createTestUser('primary')
  await use(user)
  await deleteTestUser(user.id) // Always runs, even on failure
},
```

### 4.4 Database Reset Strategy

| Environment | Strategy |
|-------------|----------|
| **Local development** | Per-test cleanup via fixtures |
| **CI** | `supabase db reset` before test suite |
| **Parallel tests** | Unique data identifiers to avoid conflicts |

### 4.5 RLS Verification

Always verify RLS policies work correctly:

```typescript
// Verify user can't see other users' data
await verifyRLS({
  setup: async (admin) => {
    // Create data owned by another user
    await admin.from('leagues').insert({ owner_id: 'other-user-id', ... })
  },
  test: async (userClient) => {
    const { data } = await userClient.from('leagues').select()
    expect(data).toHaveLength(0) // User shouldn't see it
  },
  user: testUser,
})
```

### 4.6 Real-time Testing

For Supabase Realtime subscriptions:

```typescript
// Wait for real-time update after action
await page.click('[data-testid="draft-pick-button"]')

// Verify update propagates to other user's page
await expect(otherUserPage.getByTestId('draft-history'))
  .toContainText('Movie Title', { timeout: 10000 })
```

### 4.7 Edge Function Testing

Test Edge Functions through the app UI (integration) rather than calling directly (unit):

- **Integration (E2E)**: User clicks "Draft" → UI calls Edge Function → Result displayed
- **Unit (separate)**: Direct HTTP calls to Edge Function with mocked Supabase

### References

- [Supawright](https://github.com/isaacharrisholt/supawright) - Playwright test harness for Supabase
- [Fireship Supabase Course](https://fireship.io/courses/supabase/setup-playwright/) - E2E testing setup
- [Supabase Testing Docs](https://supabase.com/docs/guides/local-development/testing/overview)

---

## 5. Test Fixtures & Authentication

### Authenticated User Fixture

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base, Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role for test setup
)

interface TestUser {
  id: string
  email: string
  password: string
  displayName: string
}

interface AuthFixtures {
  authenticatedPage: Page
  testUser: TestUser
  secondUser: TestUser  // For multi-user tests
  leagueOwner: TestUser
}

export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    const user = await createTestUser('primary')
    await use(user)
    await cleanupTestUser(user.id)
  },

  secondUser: async ({}, use) => {
    const user = await createTestUser('secondary')
    await use(user)
    await cleanupTestUser(user.id)
  },

  leagueOwner: async ({}, use) => {
    const user = await createTestUser('owner')
    await use(user)
    await cleanupTestUser(user.id)
  },

  authenticatedPage: async ({ page, testUser }, use) => {
    // Login via UI (tests real auth flow)
    await page.goto('/login')
    await page.fill('[data-testid="email-input"]', testUser.email)
    await page.fill('[data-testid="password-input"]', testUser.password)
    await page.click('[data-testid="login-button"]')
    await page.waitForURL('/dashboard')

    await use(page)
  },
})

async function createTestUser(prefix: string): Promise<TestUser> {
  const timestamp = Date.now()
  const email = `test-${prefix}-${timestamp}@test.local`
  const password = 'TestPassword123!'
  const displayName = `Test User ${prefix}`

  // Create user via admin API
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Skip email verification for tests
    user_metadata: { display_name: displayName },
  })

  if (error) throw error

  // Create profile
  await supabase.from('profiles').insert({
    id: data.user.id,
    user_id: data.user.id,
    display_name: displayName,
  })

  return {
    id: data.user.id,
    email,
    password,
    displayName,
  }
}

async function cleanupTestUser(userId: string): Promise<void> {
  // Cascade delete handles most cleanup via foreign keys
  await supabase.auth.admin.deleteUser(userId)
}

export { expect } from '@playwright/test'
```

### League Fixture

```typescript
// e2e/fixtures/league.fixture.ts
import { test as authTest, TestUser } from './auth.fixture'
import { createClient } from '@supabase/supabase-js'

interface LeagueFixtures {
  testLeague: TestLeague
  draftReadyLeague: TestLeague  // League with participants, ready for draft
  activeLeague: TestLeague      // Post-draft league with scores
}

interface TestLeague {
  id: string
  name: string
  ownerId: string
  status: 'setup' | 'drafting' | 'active' | 'completed'
}

export const test = authTest.extend<LeagueFixtures>({
  testLeague: async ({ leagueOwner }, use) => {
    const league = await createTestLeague(leagueOwner.id, 'setup')
    await use(league)
    await cleanupLeague(league.id)
  },

  draftReadyLeague: async ({ leagueOwner, testUser, secondUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, 'setup')

    // Add participants
    await addParticipant(league.id, testUser.id)
    await addParticipant(league.id, secondUser.id)

    // Create teams for all participants
    await createTeam(league.id, leagueOwner.id, 'Owner Team')
    await createTeam(league.id, testUser.id, 'Test Team')
    await createTeam(league.id, secondUser.id, 'Second Team')

    await use(league)
    await cleanupLeague(league.id)
  },

  activeLeague: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, 'active')

    // Add participant with team and draft picks
    await addParticipant(league.id, testUser.id)
    const team = await createTeam(league.id, testUser.id, 'Test Team')
    await createDraftPicks(league.id, team.id)

    await use(league)
    await cleanupLeague(league.id)
  },
})
```

---

## 6. Critical User Journeys

### Priority 1: Authentication (Gate to Everything)

```typescript
// e2e/tests/auth/signup.spec.ts
import { test, expect } from '@playwright/test'
import { getLatestEmail, clearMailbox } from '../../helpers/email.helper'

test.describe('User Signup', () => {
  const testEmail = `signup-test-${Date.now()}@test.local`

  test.beforeEach(async () => {
    await clearMailbox(testEmail)
  })

  test('complete signup flow with email verification', async ({ page }) => {
    // Navigate to signup
    await page.goto('/signup')

    // Fill form
    await page.fill('[data-testid="display-name-input"]', 'New Test User')
    await page.fill('[data-testid="email-input"]', testEmail)
    await page.fill('[data-testid="password-input"]', 'SecurePassword123!')

    // Submit
    await page.click('[data-testid="signup-button"]')

    // Should show confirmation message
    await expect(page.getByText(/check your email/i)).toBeVisible()

    // Get confirmation email
    const email = await getLatestEmail(testEmail)
    expect(email.subject).toContain('Confirm')

    // Click confirmation link
    const confirmLink = email.links.find(l => l.includes('/auth/confirm'))
    expect(confirmLink).toBeTruthy()

    await page.goto(confirmLink!)

    // Should redirect to login
    await page.waitForURL('/login')
    await expect(page.getByText(/email confirmed/i)).toBeVisible()
  })

  test('shows validation errors for invalid input', async ({ page }) => {
    await page.goto('/signup')

    // Submit empty form
    await page.click('[data-testid="signup-button"]')

    // Should show validation errors
    await expect(page.getByText(/display name is required/i)).toBeVisible()
    await expect(page.getByText(/email is required/i)).toBeVisible()
    await expect(page.getByText(/password is required/i)).toBeVisible()
  })

  test('shows error for existing email', async ({ page }) => {
    // First signup
    await page.goto('/signup')
    await page.fill('[data-testid="display-name-input"]', 'First User')
    await page.fill('[data-testid="email-input"]', testEmail)
    await page.fill('[data-testid="password-input"]', 'Password123!')
    await page.click('[data-testid="signup-button"]')
    await page.waitForSelector('text=/check your email/i')

    // Second signup with same email
    await page.goto('/signup')
    await page.fill('[data-testid="display-name-input"]', 'Second User')
    await page.fill('[data-testid="email-input"]', testEmail)
    await page.fill('[data-testid="password-input"]', 'Password456!')
    await page.click('[data-testid="signup-button"]')

    // Should show error
    await expect(page.getByText(/already registered/i)).toBeVisible()
  })
})
```

```typescript
// e2e/tests/auth/login.spec.ts
import { test, expect } from '../../fixtures/auth.fixture'

test.describe('User Login', () => {
  test('successful login redirects to dashboard', async ({ page, testUser }) => {
    await page.goto('/login')

    await page.fill('[data-testid="email-input"]', testUser.email)
    await page.fill('[data-testid="password-input"]', testUser.password)
    await page.click('[data-testid="login-button"]')

    await page.waitForURL('/dashboard')
    await expect(page.getByText(testUser.displayName)).toBeVisible()
  })

  test('invalid credentials show error', async ({ page }) => {
    await page.goto('/login')

    await page.fill('[data-testid="email-input"]', 'nonexistent@test.local')
    await page.fill('[data-testid="password-input"]', 'WrongPassword')
    await page.click('[data-testid="login-button"]')

    await expect(page.getByText(/invalid login credentials/i)).toBeVisible()
  })

  test('preserves return URL after login', async ({ page, testUser }) => {
    // Try to access protected page
    await page.goto('/league/some-id/draft')

    // Should redirect to login with return URL
    await page.waitForURL(/\/login\?.*returnUrl/)

    // Login
    await page.fill('[data-testid="email-input"]', testUser.email)
    await page.fill('[data-testid="password-input"]', testUser.password)
    await page.click('[data-testid="login-button"]')

    // Should redirect back to original page (or 404 if league doesn't exist)
    await expect(page.url()).toContain('/league/')
  })
})
```

### Priority 2: League Creation & Management

```typescript
// e2e/tests/league/create-league.spec.ts
import { test, expect } from '../../fixtures/auth.fixture'

test.describe('Create League', () => {
  test('owner can create a new league', async ({ authenticatedPage }) => {
    const page = authenticatedPage

    // Open create modal
    await page.click('[data-testid="create-league-button"]')

    // Fill form
    const leagueName = `Test League ${Date.now()}`
    await page.fill('[data-testid="league-name-input"]', leagueName)
    await page.fill('[data-testid="max-participants-input"]', '8')
    await page.selectOption('[data-testid="draft-type-select"]', 'snake')

    // Submit
    await page.click('[data-testid="create-league-submit"]')

    // Should navigate to new league
    await page.waitForURL(/\/league\/[a-f0-9-]+/)
    await expect(page.getByText(leagueName)).toBeVisible()
    await expect(page.getByText(/setup/i)).toBeVisible() // Status badge
  })

  test('validates required fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage

    await page.click('[data-testid="create-league-button"]')
    await page.click('[data-testid="create-league-submit"]')

    await expect(page.getByText(/league name is required/i)).toBeVisible()
  })
})
```

```typescript
// e2e/tests/league/join-league.spec.ts
import { test, expect } from '../../fixtures/league.fixture'

test.describe('Join League', () => {
  test('user can join via invitation link', async ({ page, testLeague, testUser }) => {
    // Create invitation
    const invitation = await createInvitation(testLeague.id, testUser.email)

    // Login as invited user
    await loginAs(page, testUser)

    // Visit join page with token
    await page.goto(`/join?token=${invitation.token}`)

    // Should show league details
    await expect(page.getByText(testLeague.name)).toBeVisible()

    // Accept invitation
    await page.click('[data-testid="join-league-button"]')

    // Should redirect to league page
    await page.waitForURL(`/league/${testLeague.id}`)
  })

  test('shows error for invalid token', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/join?token=invalid-token-12345')

    await expect(authenticatedPage.getByText(/invalid.*invitation/i)).toBeVisible()
  })

  test('shows error for expired token', async ({ authenticatedPage, testLeague }) => {
    const expiredInvitation = await createExpiredInvitation(testLeague.id)

    await authenticatedPage.goto(`/join?token=${expiredInvitation.token}`)

    await expect(authenticatedPage.getByText(/expired/i)).toBeVisible()
  })
})
```

### Priority 3: Draft Flow (Core Feature)

```typescript
// e2e/tests/draft/draft-flow.spec.ts
import { test, expect } from '../../fixtures/league.fixture'
import { mockTMDbAPI, MOCK_MOVIES } from '../../helpers/mock-api.helper'

test.describe('Draft Flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTMDbAPI(page)
  })

  test('complete draft round with multiple users', async ({
    browser,
    draftReadyLeague,
    leagueOwner,
    testUser,
    secondUser,
  }) => {
    // Create browser contexts for each user
    const ownerContext = await browser.newContext()
    const user1Context = await browser.newContext()
    const user2Context = await browser.newContext()

    const ownerPage = await ownerContext.newPage()
    const user1Page = await user1Context.newPage()
    const user2Page = await user2Context.newPage()

    // Setup mocks for all pages
    await mockTMDbAPI(ownerPage)
    await mockTMDbAPI(user1Page)
    await mockTMDbAPI(user2Page)

    // Login all users
    await loginAs(ownerPage, leagueOwner)
    await loginAs(user1Page, testUser)
    await loginAs(user2Page, secondUser)

    // Owner starts draft
    await ownerPage.goto(`/league/${draftReadyLeague.id}/draft`)
    await ownerPage.click('[data-testid="start-draft-button"]')
    await expect(ownerPage.getByText(/draft started/i)).toBeVisible()

    // All users navigate to draft
    await user1Page.goto(`/league/${draftReadyLeague.id}/draft`)
    await user2Page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Verify draft board shows for all
    await expect(ownerPage.getByTestId('draft-board')).toBeVisible()
    await expect(user1Page.getByTestId('draft-board')).toBeVisible()
    await expect(user2Page.getByTestId('draft-board')).toBeVisible()

    // Owner makes first pick (assuming snake draft, owner picks first)
    await expect(ownerPage.getByText(/your turn/i)).toBeVisible()
    await ownerPage.click(`[data-testid="movie-card-${MOCK_MOVIES[0].id}"]`)
    await ownerPage.click('[data-testid="draft-pick-button"]')

    // Verify pick shows in history for all users (real-time)
    await expect(ownerPage.getByTestId('draft-history')).toContainText(MOCK_MOVIES[0].title)
    await expect(user1Page.getByTestId('draft-history')).toContainText(MOCK_MOVIES[0].title)
    await expect(user2Page.getByTestId('draft-history')).toContainText(MOCK_MOVIES[0].title)

    // Next user's turn
    await expect(user1Page.getByText(/your turn/i)).toBeVisible()
    await user1Page.click(`[data-testid="movie-card-${MOCK_MOVIES[1].id}"]`)
    await user1Page.click('[data-testid="draft-pick-button"]')

    // Verify second pick propagates
    await expect(user2Page.getByTestId('draft-history')).toContainText(MOCK_MOVIES[1].title)

    // Cleanup
    await ownerContext.close()
    await user1Context.close()
    await user2Context.close()
  })

  test('movie search filters correctly', async ({ authenticatedPage, draftReadyLeague }) => {
    const page = authenticatedPage

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Search for specific movie
    await page.fill('[data-testid="movie-search-input"]', 'Alpha')

    // Wait for debounced search
    await page.waitForTimeout(400) // 300ms debounce + buffer

    // Should only show matching movie
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[0].id}`)).toBeVisible()
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[1].id}`)).not.toBeVisible()
  })

  test('cannot pick already-drafted movie', async ({ authenticatedPage, draftReadyLeague }) => {
    const page = authenticatedPage

    // Setup: Draft a movie first
    await draftMovie(draftReadyLeague.id, MOCK_MOVIES[0].id)

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Drafted movie should not appear in picker
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[0].id}`)).not.toBeVisible()
  })

  test('shows error when picking out of turn', async ({
    browser,
    draftReadyLeague,
    testUser,
    secondUser,
  }) => {
    // Create two user sessions
    const user1Context = await browser.newContext()
    const user2Context = await browser.newContext()

    const user1Page = await user1Context.newPage()
    const user2Page = await user2Context.newPage()

    await mockTMDbAPI(user1Page)
    await mockTMDbAPI(user2Page)

    await loginAs(user1Page, testUser)
    await loginAs(user2Page, secondUser)

    // Start draft (assume user1 picks first)
    await startDraft(draftReadyLeague.id)

    // User2 tries to pick (not their turn)
    await user2Page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Pick button should be disabled or show "waiting"
    await expect(user2Page.getByText(/waiting for/i)).toBeVisible()

    await user1Context.close()
    await user2Context.close()
  })
})
```

### Priority 4: Bidding System

```typescript
// e2e/tests/bidding/place-bid.spec.ts
import { test, expect } from '../../fixtures/league.fixture'
import { mockTMDbAPI, MOCK_MOVIES } from '../../helpers/mock-api.helper'

test.describe('Bidding System', () => {
  test('user can place and cancel a bid', async ({ authenticatedPage, activeLeague }) => {
    const page = authenticatedPage
    await mockTMDbAPI(page)

    await page.goto(`/league/${activeLeague.id}/bidding`)

    // Open bid modal
    await page.click('[data-testid="place-bid-button"]')

    // Search for movie
    await page.fill('[data-testid="bid-movie-search"]', MOCK_MOVIES[0].title)
    await page.click(`[data-testid="bid-movie-option-${MOCK_MOVIES[0].id}"]`)

    // Enter bid amount
    await page.fill('[data-testid="bid-amount-input"]', '50')

    // Submit bid
    await page.click('[data-testid="submit-bid-button"]')

    // Verify bid appears in "My Bids"
    await expect(page.getByTestId('my-bids-section')).toContainText(MOCK_MOVIES[0].title)
    await expect(page.getByTestId('my-bids-section')).toContainText('$50')

    // Cancel bid
    await page.click('[data-testid="cancel-bid-button"]')
    await page.click('[data-testid="confirm-cancel-button"]')

    // Verify bid removed
    await expect(page.getByTestId('my-bids-section')).not.toContainText(MOCK_MOVIES[0].title)
  })

  test('outbid notification appears in real-time', async ({
    browser,
    activeLeague,
    testUser,
    secondUser,
  }) => {
    const user1Context = await browser.newContext()
    const user2Context = await browser.newContext()

    const user1Page = await user1Context.newPage()
    const user2Page = await user2Context.newPage()

    await mockTMDbAPI(user1Page)
    await mockTMDbAPI(user2Page)

    await loginAs(user1Page, testUser)
    await loginAs(user2Page, secondUser)

    // User1 places initial bid
    await user1Page.goto(`/league/${activeLeague.id}/bidding`)
    await placeBid(user1Page, MOCK_MOVIES[0].id, 50)

    // User2 outbids
    await user2Page.goto(`/league/${activeLeague.id}/bidding`)
    await placeBid(user2Page, MOCK_MOVIES[0].id, 75)

    // User1 should see outbid notification (real-time)
    await expect(user1Page.getByText(/outbid/i)).toBeVisible({ timeout: 5000 })

    await user1Context.close()
    await user2Context.close()
  })
})
```

### Priority 5: Trading System

```typescript
// e2e/tests/trading/propose-trade.spec.ts
import { test, expect } from '../../fixtures/league.fixture'

test.describe('Trading System', () => {
  test('complete trade flow: propose, accept, verify rosters', async ({
    browser,
    activeLeague,
    testUser,
    secondUser,
  }) => {
    const user1Context = await browser.newContext()
    const user2Context = await browser.newContext()

    const user1Page = await user1Context.newPage()
    const user2Page = await user2Context.newPage()

    await loginAs(user1Page, testUser)
    await loginAs(user2Page, secondUser)

    // User1 proposes trade
    await user1Page.goto(`/league/${activeLeague.id}/trading`)
    await user1Page.click('[data-testid="propose-trade-button"]')

    // Select recipient
    await user1Page.selectOption('[data-testid="trade-recipient-select"]', secondUser.displayName)

    // Select movies to offer/request
    await user1Page.click('[data-testid="offer-movie-checkbox-0"]')
    await user1Page.click('[data-testid="request-movie-checkbox-0"]')

    // Submit proposal
    await user1Page.click('[data-testid="submit-trade-button"]')

    // User2 sees pending trade (real-time)
    await user2Page.goto(`/league/${activeLeague.id}/trading`)
    await expect(user2Page.getByTestId('pending-trades-section')).toContainText('Trade Offer')

    // User2 accepts
    await user2Page.click('[data-testid="accept-trade-button"]')
    await user2Page.click('[data-testid="confirm-accept-button"]')

    // Both users see trade completed
    await expect(user2Page.getByText(/trade completed/i)).toBeVisible()

    // Verify rosters swapped
    await user1Page.goto(`/league/${activeLeague.id}/roster`)
    // Verify user1 now has the movie they requested

    await user2Page.goto(`/league/${activeLeague.id}/roster`)
    // Verify user2 now has the movie they received

    await user1Context.close()
    await user2Context.close()
  })

  test('counter-trade flow', async ({ browser, activeLeague, testUser, secondUser }) => {
    // Similar to above but with counter-trade step
  })

  test('owner can veto trade', async ({ browser, activeLeague, leagueOwner, testUser, secondUser }) => {
    // Create trade, owner vetoes
  })
})
```

---

## 7. Test Data Management

### Database Seeding

```typescript
// e2e/global-setup.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function globalSetup() {
  console.log('🔧 Setting up test database...')

  // Clear test data from previous runs
  await supabase.rpc('cleanup_test_data')

  // Seed base data if needed
  await seedTestMovies()

  console.log('✅ Test database ready')
}

async function seedTestMovies() {
  // Insert mock movies that match our MOCK_MOVIES constant
  const movies = [
    {
      tmdb_id: 12345,
      title: 'Test Movie Alpha',
      release_date: '2025-06-15',
      poster_url: '/test-poster-alpha.jpg',
      status: 'upcoming',
    },
    {
      tmdb_id: 12346,
      title: 'Test Movie Beta',
      release_date: '2025-07-20',
      poster_url: '/test-poster-beta.jpg',
      status: 'upcoming',
    },
  ]

  await supabase.from('movies').upsert(movies, { onConflict: 'tmdb_id' })
}
```

### Cleanup Helper

```sql
-- supabase/migrations/xxx_test_cleanup_function.sql
-- Only applied in test/local environments

CREATE OR REPLACE FUNCTION cleanup_test_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete test users (cascade handles related data)
  DELETE FROM auth.users
  WHERE email LIKE 'test-%@test.local';

  -- Delete test leagues
  DELETE FROM leagues
  WHERE name LIKE 'Test League %';
END;
$$;
```

---

## 8. CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Start Supabase
        run: |
          npx supabase start
          npx supabase db reset --no-seed

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: apps/frontend/playwright-report/
          retention-days: 7

      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-artifacts
          path: |
            apps/frontend/test-results/
          retention-days: 7
```

### Package.json Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

---

## 9. Test Coverage Matrix

### Critical Paths (Must Pass Before Deploy)

| Journey | Test File | Priority |
|---------|-----------|----------|
| Signup → Email Verify → Login | `auth/signup.spec.ts` | P0 |
| Login → Dashboard | `auth/login.spec.ts` | P0 |
| Create League | `league/create-league.spec.ts` | P0 |
| Join League via Invitation | `league/join-league.spec.ts` | P0 |
| Start Draft → Make Picks | `draft/draft-flow.spec.ts` | P0 |
| Real-time Draft Updates | `draft/draft-realtime.spec.ts` | P0 |
| View Standings | `standings/leaderboard.spec.ts` | P1 |
| Place/Cancel Bid | `bidding/place-bid.spec.ts` | P1 |
| Propose/Accept Trade | `trading/propose-trade.spec.ts` | P1 |
| Password Reset | `auth/password-reset.spec.ts` | P1 |
| League Settings (Owner) | `league/league-settings.spec.ts` | P2 |
| Counterpick Round | `draft/counterpick.spec.ts` | P2 |
| Drop Movie | `roster/drop-movie.spec.ts` | P2 |

### Test Tagging Strategy

```typescript
// Use tags for selective test runs
test('critical login flow @critical @auth', async ({ page }) => { ... })
test('outbid notification @realtime @bidding', async ({ page }) => { ... })

// Run only critical tests
// npx playwright test --grep @critical

// Run all auth tests
// npx playwright test --grep @auth
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1)

1. Install and configure Playwright
2. Create fixture infrastructure (auth, league)
3. Implement mock helpers for TMDb/OMDb
4. Write email helper for Inbucket
5. Implement P0 auth tests (signup, login)

### Phase 2: Core Journeys (Week 2)

1. League creation/join tests
2. Basic draft flow (single user)
3. Multi-user draft with real-time
4. Standings/leaderboard tests

### Phase 3: Advanced Features (Week 3)

1. Bidding system tests
2. Trading system tests
3. Roster management tests
4. Counterpick tests

### Phase 4: Polish & CI (Week 4)

1. CI/CD integration
2. Test tagging and organization
3. Documentation
4. Performance optimization

---

## 11. Best Practices

### Do's

- **Test real flows**: Login through UI, not by injecting tokens
- **Use data-testid**: Add stable test selectors to components
- **Isolate tests**: Each test creates its own data, cleans up after
- **Test real-time**: Verify WebSocket updates work correctly
- **Parallel execution**: Design tests to run independently
- **Visual regression**: Consider adding screenshot comparisons for UI

### Don'ts

- **Don't mock Supabase**: Test real RLS policies and Edge Functions
- **Don't share state**: Tests should not depend on each other
- **Don't use sleep**: Use `waitForSelector`, `waitForURL`, `expect().toBeVisible()`
- **Don't test implementation**: Test user behavior, not internal state
- **Don't skip cleanup**: Always clean up test data to avoid flaky tests

### Data-TestId Conventions

Add these selectors to components:

```tsx
// Buttons
<button data-testid="create-league-button">Create League</button>
<button data-testid="start-draft-button">Start Draft</button>
<button data-testid="draft-pick-button">Pick Movie</button>

// Inputs
<input data-testid="email-input" />
<input data-testid="movie-search-input" />
<input data-testid="bid-amount-input" />

// Containers
<div data-testid="draft-board">...</div>
<div data-testid="draft-history">...</div>
<div data-testid="my-bids-section">...</div>

// Dynamic elements
<div data-testid={`movie-card-${movie.tmdb_id}`}>...</div>
<button data-testid={`cancel-bid-${bid.id}`}>Cancel</button>
```

---

## Appendix: Required data-testid Additions

Components that need `data-testid` attributes for E2E testing:

### Auth Components
- `/app/(public)/login/page.tsx`: email-input, password-input, login-button
- `/app/(public)/signup/page.tsx`: display-name-input, email-input, password-input, signup-button
- `/app/(public)/forgot-password/page.tsx`: email-input, reset-button
- `/app/(public)/reset-password/page.tsx`: password-input, confirm-password-input, submit-button

### Dashboard
- `/app/components/CreateLeagueModal.tsx`: league-name-input, max-participants-input, draft-type-select, create-league-submit
- `/app/(authenticated)/dashboard/page.tsx`: create-league-button

### Draft
- `/app/(authenticated)/league/[id]/draft/DraftBoard.tsx`: draft-board, draft-history, start-draft-button
- `/app/(authenticated)/league/[id]/draft/MoviePicker.tsx`: movie-search-input
- `/app/(authenticated)/league/[id]/draft/DraftMovieCard.tsx`: movie-card-{tmdbId}, draft-pick-button

### Bidding
- `/app/(authenticated)/league/[id]/bidding/BiddingPanel.tsx`: my-bids-section, place-bid-button
- `/app/(authenticated)/league/[id]/bidding/PlaceBidModal.tsx`: bid-movie-search, bid-amount-input, submit-bid-button
- `/app/(authenticated)/league/[id]/bidding/BidCard.tsx`: cancel-bid-button

### Trading
- `/app/(authenticated)/league/[id]/trading/TradingPanel.tsx`: pending-trades-section, propose-trade-button
- `/app/(authenticated)/league/[id]/trading/ProposeTradeModal.tsx`: trade-recipient-select, submit-trade-button
- `/app/(authenticated)/league/[id]/trading/TradeOfferCard.tsx`: accept-trade-button, reject-trade-button

---

This strategy ensures comprehensive E2E coverage while maintaining the principle of testing real production behavior. External API mocking keeps tests deterministic without sacrificing the integrity of testing our own backend systems.
