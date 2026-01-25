# Edge Functions Testing Guide

This document describes the testing infrastructure for Supabase Edge Functions in the Fantasy Reel project.

## Quick Start

```bash
# 1. Start local Supabase
npx supabase start

# 2. (First time only) Create the .env.test file
cp supabase/functions/.env.test.example supabase/functions/.env.test

# 3. Run tests
npm run test:functions
```

## Test Structure

```
supabase/functions/
├── deno.json              # Test configuration with tasks and imports
├── .env.test              # Environment variables for local testing
├── tests/
│   ├── _setup.ts          # Test utilities, factories, and helpers
│   ├── create-league.test.ts
│   ├── draft-pick.test.ts
│   ├── get-leagues.test.ts
│   └── ... (other test files)
└── _shared/
    ├── utils.test.ts      # Unit tests for shared utilities
    └── email.test.ts      # Unit tests for email functions
```

## Test Types

### Unit Tests (`_shared/*.test.ts`)
- Test pure functions without external dependencies
- Run without Supabase services
- Fast execution, no setup required

### Integration Tests (`tests/*.test.ts`)
- Test actual Edge Functions via `client.functions.invoke()`
- Require local Supabase running
- Test authentication, validation, and business logic

## Running Tests

### Prerequisites

Start local Supabase (this automatically serves Edge Functions):

```bash
npx supabase start
```

> **Note:** You do NOT need to run `npx supabase functions serve` separately. The `supabase start` command serves Edge Functions automatically at `http://127.0.0.1:54321/functions/v1/`.

### Commands

**IMPORTANT:** Always use these commands - they automatically load the correct environment variables.

```bash
# From project root (RECOMMENDED)
npm run test:functions           # Run integration tests
npm run test:functions:watch     # Run in watch mode

# From supabase/functions directory
deno task test                   # Integration tests only
deno task test:unit              # Unit tests only
deno task test:all               # All tests
deno task test:watch             # Integration tests with watch mode
```

> **Warning:** Do NOT run `deno test` directly - it won't load the `.env.test` file. Always use `deno task test` or `npm run test:functions`.

## Writing Tests

### File Naming
Tests must use `.test.ts` suffix (not `-test.ts`) for Deno's test discovery:
- ✅ `create-league.test.ts`
- ❌ `create-league-test.ts`

### Test Structure Pattern

```typescript
import { assertEquals, assertExists } from '@std/assert'
import { createTestFactory, getAnonClient, uniqueName, invokeFunction } from './_setup.ts'

Deno.test({
  name: 'function-name',
  // Disable sanitizers - Supabase client has internal intervals
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const { client, secondClient, factory } = await createTestFactory()

    // Test unauthorized access
    await t.step('returns 401 when not authenticated', async () => {
      const anonClient = getAnonClient()
      const result = await invokeFunction(anonClient, 'function-name', { body })
      assertEquals(result.error, 'Unauthorized')
    })

    // Test validation errors
    await t.step('returns 400 for invalid input', async () => {
      const result = await invokeFunction(client, 'function-name', { invalid: true })
      assertEquals(result.error, 'Expected error message')
    })

    // Test success cases
    await t.step('creates resource successfully', async () => {
      const { data, error } = await client.functions.invoke('function-name', {
        body: { valid: 'data' }
      })
      assertEquals(error, null)
      assertExists(data.resource)
      factory.trackLeague(data.resource.id) // Track for cleanup
    })

    // Always cleanup
    await t.step('cleanup test data', async () => {
      await factory.cleanup()
    })
  }
})
```

### Key Patterns

#### Using `invokeFunction` for Error Handling
The Supabase SDK's `functions.invoke()` returns `data: null` for non-2xx responses. Use the `invokeFunction` helper to properly extract error messages:

```typescript
// For tests that check error responses
const result = await invokeFunction(client, 'function-name', body)
assertEquals(result.error, 'Expected error message')

// For tests that check success responses
const { data, error } = await client.functions.invoke('function-name', { body })
assertEquals(error, null)
assertExists(data.resource)
```

#### Test Data Factory
Use `TestDataFactory` for creating test data with automatic cleanup:

```typescript
const { client, secondClient, factory } = await createTestFactory()

// Create test league
const { id: leagueId } = await factory.createLeague('Test League')

// Add second participant
await factory.addSecondParticipant(leagueId)

// Create drafting league (2 participants + started draft)
const draftingLeagueId = await factory.createDraftingLeague('Drafting League')

// Create active league (draft completed, ready for bidding/drops)
const activeLeagueId = await factory.createActiveLeague('Active League')

// Create pickup for testing drops
const pickupId = await factory.createPickupForUser(leagueId, client, movieData)

// Create draft pick for testing drops
const draftPickId = await factory.createDraftPickForUser(leagueId, client, movieData)

// Create league with invitation
const { leagueId, invitationId, token } = await factory.createLeagueWithInvitation('League')

// Track externally created leagues
factory.trackLeague(someExternalLeagueId)

// Cleanup at end of test
await factory.cleanup()
```

#### Unique Names
Use `uniqueName()` to avoid conflicts:

```typescript
const leagueName = uniqueName('my-test')  // "my-test-1737341234567-abc123"
```

## Test Utilities Reference

| Utility | Purpose |
|---------|---------|
| `createTestFactory()` | Creates authenticated clients and test factory |
| `getAnonClient()` | Creates unauthenticated client for 401 tests |
| `getAuthenticatedClient()` | Creates client for primary test user |
| `getSecondAuthenticatedClient()` | Creates client for secondary test user |
| `getThirdAuthenticatedClient()` | Creates client for third test user (multi-user tests) |
| `invokeFunction(client, name, body)` | Invokes function with proper error extraction |
| `uniqueName(prefix)` | Generates unique name with timestamp |
| `TEST_USER` / `TEST_USER_2` / `TEST_USER_3` | Test user credentials |

## Environment Variables

### Setup (First Time)

1. Copy the example file:
   ```bash
   cp supabase/functions/.env.test.example supabase/functions/.env.test
   ```

2. The default values use Supabase's standard local development keys, which should work out of the box.

### Required Variables

| Variable | Description | How to Get |
|----------|-------------|------------|
| `SUPABASE_URL` | Local API URL | Default: `http://127.0.0.1:54321` |
| `SUPABASE_ANON_KEY` | Anonymous JWT key | `npx supabase status` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT key (for admin operations) | `npx supabase status` |

### Verifying Your Setup

```bash
# Check if Supabase is running and get the keys
npx supabase status
```

Look for the output:
```
         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
        anon key: eyJhbGciOiJIUzI1...
service_role key: eyJhbGciOiJIUzI1...
```

Copy the `anon key` and `service_role key` to your `.env.test` if they differ from the defaults.

### Note on Standard Keys

Supabase uses standardized JWT keys for local development:
- These are **NOT** secrets - they are publicly known test keys
- They work across all local Supabase instances
- **NEVER** use these keys in production

## Troubleshooting

### "No test modules found"
- Ensure test files use `.test.ts` suffix (not `-test.ts`)

### "Missing required environment variables"
- **Are you running `deno test` directly?** Use `deno task test` instead
- Ensure `.env.test` exists in `supabase/functions/`
- Ensure local Supabase is running: `npx supabase status`

### "Edge Function returned a non-2xx status code"
- Use `invokeFunction()` helper to properly extract error messages
- Check that Supabase is running: `npx supabase status`

### "Connection refused" or "ECONNREFUSED"
- Local Supabase isn't running. Start it with: `npx supabase start`

### Resource/Op Leaks
- Use `sanitizeResources: false` and `sanitizeOps: false` in test definition
- Supabase client has internal intervals that trigger leak detection

### Test Assertion Mismatches
If tests fail with different error messages than expected, update the test assertions to match actual Edge Function behavior:
```typescript
// Check what the function actually returns
const result = await invokeFunction(client, 'function-name', body)
console.log('Actual error:', result.error)
```

## E2E Testing (Future Work)

The project does not currently have E2E tests configured. When setting up Playwright for frontend E2E testing, the following flows should be covered:

### Trading System E2E Tests (Priority)

1. **Propose Trade Flow**
   - Navigate to league trades tab
   - Click "Propose Trade"
   - Select recipient team
   - Add movies/FAAB to offer
   - Add movies/FAAB to request
   - Submit proposal
   - Verify trade appears in pending list

2. **Accept Trade Flow**
   - As recipient, view incoming trade
   - Click "Accept"
   - Confirm in modal
   - Verify trade moves to completed
   - Verify movies transferred correctly

3. **Counter Trade Flow**
   - As recipient, view incoming trade
   - Click "Counter"
   - Modify trade terms
   - Submit counter
   - Original proposer sees updated trade

4. **Reject Trade Flow**
   - As recipient, reject trade
   - Verify trade marked as rejected
   - Verify movies returned to original owners

5. **Veto Trade Flow**
   - League owner views trade in review
   - Click "Veto" with reason
   - Verify trade vetoed and assets returned

### Playwright Setup (When Ready)

```bash
# Install Playwright in frontend
cd apps/frontend
npm install -D @playwright/test
npx playwright install

# Add to package.json scripts
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

Example E2E test structure:
```
apps/frontend/
├── e2e/
│   ├── trading.spec.ts
│   ├── draft.spec.ts
│   ├── league.spec.ts
│   └── fixtures/
│       └── test-users.ts
├── playwright.config.ts
```

---

## Load Testing / Race Condition Testing

To test concurrent operations and race conditions, use the load testing script:

```bash
# Run concurrent trade operations test
npm run test:load:trades
```

### Manual Concurrent Testing

For quick race condition testing, use this approach in a Deno script:

```typescript
// scripts/test-concurrent-trades.ts
import { createClient } from '@supabase/supabase-js'

const NUM_CONCURRENT = 5
const SUPABASE_URL = 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = '...'

async function testConcurrentBids(leagueId: string, movieId: string) {
  // Create multiple clients (simulating different users)
  const clients = await Promise.all(
    Array(NUM_CONCURRENT).fill(null).map(async (_, i) => {
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      // Sign in as different test users
      await client.auth.signInWithPassword({
        email: `load-test-${i}@example.com`,
        password: 'test-password-123!'
      })
      return client
    })
  )

  // Fire concurrent bid requests
  console.log(`Firing ${NUM_CONCURRENT} concurrent bids...`)
  const results = await Promise.allSettled(
    clients.map((client, i) =>
      client.functions.invoke('place-bid', {
        body: {
          league_id: leagueId,
          tmdb_id: 12345,
          amount: 50 + i, // Different amounts
        }
      })
    )
  )

  // Analyze results
  const successes = results.filter(r => r.status === 'fulfilled')
  const failures = results.filter(r => r.status === 'rejected')

  console.log(`Successes: ${successes.length}`)
  console.log(`Failures: ${failures.length}`)

  // Only ONE should win (highest bid)
  // Others should get "outbid" errors
}
```

### What to Test for Race Conditions

1. **Same movie in multiple trades** - Should prevent accepting both
2. **Concurrent bid processing** - Only highest bid should win
3. **FAAB budget exhaustion** - Can't spend more than available
4. **Trade execution conflicts** - Same movie can't be in two accepted trades

---

## Sources

- [Supabase Testing Docs](https://supabase.com/docs/guides/functions/unit-test)
- [Supabase Error Handling](https://supabase.com/docs/guides/functions/error-handling)
- [Deno Test Runner](https://docs.deno.com/runtime/manual/testing/)
- [Playwright Docs](https://playwright.dev/docs/intro)
