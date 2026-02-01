import { test, expect } from '../../fixtures/league.fixture'

/**
 * Bidding System E2E Tests
 *
 * Tests the pickup bidding flow against local Supabase.
 * Uses biddingLeague fixture which provides an active league with bidding enabled.
 *
 * Best Practices Applied:
 * - Uses fixtures for test data isolation
 * - Uses programmatic auth (authedPage) for speed
 * - Tests real Supabase operations (not mocked)
 * - Cleanup handled by fixture teardown
 *
 * @see https://fireship.io/courses/supabase/setup-playwright/
 */

test.describe('Bidding Panel @bidding', () => {
  test('bidding panel displays budget and place bid button @critical', async ({
    authedPage,
    biddingLeague,
  }) => {
    // Navigate to the bidding page
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Verify bidding panel is visible
    await expect(authedPage.getByTestId('bidding-panel')).toBeVisible({
      timeout: 10000,
    })

    // Verify budget display is visible
    await expect(authedPage.getByText(/budget/i)).toBeVisible()

    // Verify place bid button is visible
    await expect(authedPage.getByTestId('place-bid-button')).toBeVisible()
  })

  test('displays correct budget amount', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Verify the budget amount is displayed (default is $100)
    await expect(authedPage.getByText('$100')).toBeVisible()
  })
})

test.describe('Place Bid Flow @bidding', () => {
  test('can open place bid modal', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Click place bid button
    await authedPage.click('[data-testid="place-bid-button"]')

    // Verify modal opens with title
    await expect(authedPage.getByText(/place a bid/i)).toBeVisible()

    // Verify search input is visible
    await expect(
      authedPage.getByTestId('bid-movie-search-input')
    ).toBeVisible()
  })

  test('can search for movies in bid modal', async ({
    authedPage,
    biddingLeague,
  }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Open bid modal
    await authedPage.click('[data-testid="place-bid-button"]')

    // Search for a movie
    await authedPage.fill('[data-testid="bid-movie-search-input"]', 'Avatar')

    // Wait for search results (movies found text or actual results)
    await expect(
      authedPage.getByText(/movies found|Avatar/i)
    ).toBeVisible({ timeout: 10000 })
  })

  test('can select movie and see bid amount input', async ({
    authedPage,
    biddingLeague,
  }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Open bid modal
    await authedPage.click('[data-testid="place-bid-button"]')

    // Search for a movie
    await authedPage.fill('[data-testid="bid-movie-search-input"]', 'Avatar')

    // Wait for results and click first movie
    await authedPage.waitForSelector('button:has-text("Avatar")', {
      timeout: 10000,
    })
    await authedPage.click('button:has-text("Avatar")')

    // Verify bid amount input is visible
    await expect(authedPage.getByTestId('bid-amount-input')).toBeVisible()

    // Verify submit button is visible
    await expect(authedPage.getByTestId('submit-bid-button')).toBeVisible()
  })

  test('validates bid amount against budget', async ({
    authedPage,
    biddingLeague,
  }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Open bid modal and select a movie
    await authedPage.click('[data-testid="place-bid-button"]')
    await authedPage.fill('[data-testid="bid-movie-search-input"]', 'Avatar')
    await authedPage.waitForSelector('button:has-text("Avatar")', {
      timeout: 10000,
    })
    await authedPage.click('button:has-text("Avatar")')

    // Wait for bid input to be visible
    await expect(authedPage.getByTestId('bid-amount-input')).toBeVisible()

    // Clear and enter an amount exceeding budget
    await authedPage.fill('[data-testid="bid-amount-input"]', '150')

    // Verify error message is shown
    await expect(authedPage.getByText(/exceeds your budget/i)).toBeVisible()

    // Submit button should be disabled
    await expect(authedPage.getByTestId('submit-bid-button')).toBeDisabled()
  })

  test('can submit a valid bid', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)

    // Open bid modal
    await authedPage.click('[data-testid="place-bid-button"]')

    // Search and select movie
    await authedPage.fill('[data-testid="bid-movie-search-input"]', 'Avatar')
    await authedPage.waitForSelector('button:has-text("Avatar")', {
      timeout: 10000,
    })
    await authedPage.click('button:has-text("Avatar")')

    // Enter valid bid amount
    await authedPage.fill('[data-testid="bid-amount-input"]', '10')

    // Submit bid
    await authedPage.click('[data-testid="submit-bid-button"]')

    // Verify success toast appears
    await expect(authedPage.getByText(/bid.*placed/i)).toBeVisible({
      timeout: 10000,
    })

    // Verify bid appears in active bids section
    await expect(authedPage.getByText(/my active bids/i)).toBeVisible()
  })
})

test.describe('Cancel Bid Flow @bidding', () => {
  test.skip('can cancel an active bid', async ({ authedPage, biddingLeague }) => {
    // This test requires creating a bid first via the helper
    // Then navigating to bidding page and canceling it
    // Skipped until we add createPickupBid to test setup
  })
})

test.describe('Counter Bid Flow @bidding', () => {
  test.skip('shows outbid state when another user bids higher', async ({
    authedPage,
    secondUserPage,
    biddingLeague,
  }) => {
    // Multi-user test:
    // 1. User 1 places bid
    // 2. User 2 places higher bid
    // 3. User 1 sees "outbid" state
    // Skipped until multi-user flow is implemented
  })
})
