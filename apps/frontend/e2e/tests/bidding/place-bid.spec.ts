import { test, expect } from '../../fixtures/league.fixture'
import { createPickupBid, getTeamId } from '../../helpers/supabase.helper'
import { setupAllMocks, MOCK_MOVIES } from '../../helpers/mock-api.helper'
import { waitForModalOpen, waitForModalClose, waitForPageSettle } from '../../helpers/ui.helper'

/**
 * Bidding System E2E Tests
 *
 * Tests the pickup bidding flow against local Supabase.
 * Uses biddingLeague fixture which provides an active league with bidding enabled.
 *
 * Key UI elements:
 * - bidding-panel: Main bidding panel container
 * - place-bid-button: Opens the PlaceBidModal
 * - bid-movie-search-input: Search input inside the modal
 * - bid-amount-input: Bid amount input field
 * - submit-bid-button: Submit bid button (disabled when invalid)
 * - bid-card-{tmdb_id}: Individual bid cards in the active bids section
 * - cancel-bid-{tmdb_id}: Cancel button on a bid card
 * - confirm-cancel-bid: Confirm cancellation button in modal
 *
 * IMPORTANT: The PlaceBidModal uses the same useDraftMovies hook as the draft,
 * so it calls browse-movies and search-movies Edge Functions which need mocking.
 */

test.describe('Bidding Panel @bidding', () => {
  test.beforeEach(async ({ authedPage }) => {
    await setupAllMocks(authedPage)
  })

  test('bidding panel displays budget and place bid button @critical', async ({
    authedPage,
    biddingLeague,
  }) => {
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
    await expect(authedPage.getByText('$100')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Place Bid Flow @bidding', () => {
  test.beforeEach(async ({ authedPage }) => {
    await setupAllMocks(authedPage)
  })

  test('can open place bid modal', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await waitForPageSettle(authedPage)

    // Click place bid button
    await authedPage.getByTestId('place-bid-button').click()
    await waitForModalOpen(authedPage)

    // Verify modal opens - check for the search input (more reliable than title text)
    await expect(authedPage.getByTestId('bid-movie-search-input')).toBeVisible()
  })

  test('can search for movies in bid modal', async ({
    authedPage,
    biddingLeague,
  }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await waitForPageSettle(authedPage)

    // Open bid modal
    await authedPage.getByTestId('place-bid-button').click()
    await waitForModalOpen(authedPage)

    // Search for a mock movie by title
    await authedPage.getByTestId('bid-movie-search-input').fill('Alpha')

    // Wait for search results - mock should return "Test Movie Alpha"
    await expect(
      authedPage.getByTestId(`bid-movie-result-${MOCK_MOVIES[0].tmdb_id}`)
    ).toBeVisible({ timeout: 10000 })
  })

  test('can select movie and see bid amount input', async ({
    authedPage,
    biddingLeague,
  }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await waitForPageSettle(authedPage)

    // Open bid modal
    await authedPage.getByTestId('place-bid-button').click()
    await waitForModalOpen(authedPage)

    // Search for a mock movie
    await authedPage.getByTestId('bid-movie-search-input').fill('Alpha')

    // Wait for results and click the movie
    const movieResult = authedPage.getByTestId(`bid-movie-result-${MOCK_MOVIES[0].tmdb_id}`)
    await expect(movieResult).toBeVisible({ timeout: 10000 })
    await movieResult.click()

    // Verify bid amount input is visible
    await expect(authedPage.getByTestId('bid-amount-input')).toBeVisible()

    // Verify submit button is visible
    await expect(authedPage.getByTestId('submit-bid-button')).toBeVisible()
  })

  test('shows bid amount input and submit button after movie selection', async ({
    authedPage,
    biddingLeague,
  }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await waitForPageSettle(authedPage)

    // Open bid modal and select a movie
    await authedPage.getByTestId('place-bid-button').click()
    await waitForModalOpen(authedPage)
    await authedPage.getByTestId('bid-movie-search-input').fill('Alpha')

    const movieResult = authedPage.getByTestId(`bid-movie-result-${MOCK_MOVIES[0].tmdb_id}`)
    await expect(movieResult).toBeVisible({ timeout: 10000 })
    await movieResult.click()

    // Wait for bid input to be visible
    await expect(authedPage.getByTestId('bid-amount-input')).toBeVisible()

    // Enter a valid bid amount within budget
    await authedPage.getByTestId('bid-amount-input').fill('10')

    // Submit button should be enabled for a valid bid
    await expect(authedPage.getByTestId('submit-bid-button')).toBeEnabled()
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`preserves a new bid when delayed bids arrive and revalidates the amount at ${viewport.width}px`, async ({
      authedPage,
      biddingLeague,
    }) => {
      await authedPage.setViewportSize(viewport)
      const movie = MOCK_MOVIES[0]
      const ownerTeamId = await getTeamId(biddingLeague.id, biddingLeague.ownerId)
      await createPickupBid(biddingLeague.id, ownerTeamId, movie.tmdb_id, 15, {
        title: movie.title,
        releaseDate: movie.release_date,
      })

      // Let the user start before the initial bid query returns, as on a slow
      // connection. Keep the real database response and release it deliberately.
      let releaseBids!: () => void
      const bidsGate = new Promise<void>((resolve) => { releaseBids = resolve })
      await authedPage.route('**/rest/v1/pickup_bids?**', async (route) => {
        const response = await route.fetch()
        await bidsGate
        await route.fulfill({ response })
      })

      try {
        await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
        await authedPage.getByTestId('place-bid-button').click()
        await waitForModalOpen(authedPage)
        await authedPage.getByTestId('bid-movie-search-input').fill('Alpha')
        await authedPage.getByTestId(`bid-movie-result-${movie.tmdb_id}`).click()
        const amountInput = authedPage.getByTestId('bid-amount-input')
        await amountInput.fill('10')

        releaseBids()
        // The new high-bid warning proves React has consumed the delayed data;
        // waiting only for its HTTP response can precede the reset effect.
        await expect(authedPage.getByRole('dialog').getByText('Must be higher than current bid of $15')).toBeVisible()
        await expect(amountInput).toHaveValue('10')
        await expect(authedPage.getByTestId('submit-bid-button')).toBeDisabled()

        await amountInput.fill('16')
        await expect(authedPage.getByTestId('submit-bid-button')).toBeEnabled()
        await authedPage.getByTestId('submit-bid-button').click()
        await waitForModalClose(authedPage)

        // Opening an existing bid must still initialize from the latest high bid.
        await authedPage.getByTestId(`raise-bid-${movie.tmdb_id}`).click()
        await waitForModalOpen(authedPage)
        await expect(authedPage.getByTestId('bid-amount-input')).toHaveValue('17')
      } finally {
        releaseBids()
        await authedPage.unrouteAll({ behavior: 'wait' })
      }
    })
  }

  test('can submit a valid bid @critical', async ({ authedPage, biddingLeague }) => {
    await authedPage.goto(`/league/${biddingLeague.id}/bidding`)
    await waitForPageSettle(authedPage)

    // Open bid modal
    await authedPage.getByTestId('place-bid-button').click()
    await waitForModalOpen(authedPage)

    // Search for a mock movie
    await authedPage.getByTestId('bid-movie-search-input').fill('Alpha')

    // Wait for results and click the movie
    const movieResult = authedPage.getByTestId(`bid-movie-result-${MOCK_MOVIES[0].tmdb_id}`)
    await expect(movieResult).toBeVisible({ timeout: 10000 })
    await movieResult.click()

    // Enter a valid bid amount
    await authedPage.getByTestId('bid-amount-input').fill('10')

    // Submit the bid
    await expect(authedPage.getByTestId('submit-bid-button')).toBeEnabled()
    await authedPage.getByTestId('submit-bid-button').click()

    // Modal should close after successful submission
    await waitForModalClose(authedPage)

    // Verify the bid appears in the active bids list
    await expect(authedPage.getByTestId(`bid-card-${MOCK_MOVIES[0].tmdb_id}`)).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Cancel Bid Flow @bidding', () => {
  test.beforeEach(async ({ authedPage }) => {
    await setupAllMocks(authedPage)
  })

  test('can cancel an active bid', async ({ authedPage, biddingLeagueWithBid }) => {
    await authedPage.goto(`/league/${biddingLeagueWithBid.id}/bidding`)

    // Wait for bid card to appear
    const bidCard = authedPage.getByTestId(`bid-card-${biddingLeagueWithBid.bidTmdbId}`)
    await expect(bidCard).toBeVisible({ timeout: 10000 })

    // Click cancel button
    await authedPage.getByTestId(`cancel-bid-${biddingLeagueWithBid.bidTmdbId}`).click()

    // Confirm cancellation in modal
    await expect(authedPage.getByTestId('confirm-cancel-bid')).toBeVisible({ timeout: 5000 })
    await authedPage.getByTestId('confirm-cancel-bid').click()

    // Bid card should disappear or show cancelled state
    await expect(bidCard).not.toBeVisible({ timeout: 10000 })
  })
})

test.describe('Counter Bid Flow @bidding', () => {
  test.fixme('shows outbid notification when another user bids higher', async ({
    authedPage,
    secondUserPage,
    biddingLeague,
  }) => {
    // This test requires two users placing bids on the same movie in sequence.
    // It's flaky because:
    // 1. Both pages need TMDb mocks applied independently (secondUserPage doesn't get beforeEach mocks)
    // 2. The place-bid Edge Function interacts with real Supabase processing_deadline
    // 3. Outbid notification depends on email/real-time which may not propagate in test environment
    // 4. The processing_deadline NOT NULL constraint can fail without proper league_bidding_config setup
  })
})
