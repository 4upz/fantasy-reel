import { test, expect, loginAs } from '../../fixtures/league.fixture'
import { setupAllMocks, MOCK_MOVIES } from '../../helpers/mock-api.helper'
import { updateLeagueStatus } from '../../helpers/supabase.helper'

/**
 * Draft flow E2E tests
 * Tests the draft experience including starting a draft, browsing movies,
 * making picks, and multi-user real-time scenarios.
 *
 * Key UI elements:
 * - start-draft-button: Only shown to owner when league is in 'setup' status
 * - draft-board: Shown when league is in 'drafting' status
 * - movie-picker: Movie browsing/selection within draft-board
 * - movie-search-input: Search input in DraftFilters
 * - movie-card-{tmdb_id}: Individual movie cards
 * - draft-pick-button-{tmdb_id}: Draft button on each movie card (hover-revealed)
 * - confirm-pick-button: Confirm button in fixed bottom bar after selecting a movie
 * - draft-history: Pick history section (only shown when picks exist)
 * - draft-progress: Progress ring showing picks made / total
 * - pick-order-queue: Shows upcoming pick order
 *
 * NOTE: Turn-based tests (your turn, waiting state, making picks) require
 * draft_order to be set on league_participants. The current fixture doesn't
 * set draft_order, and the start-draft Edge Function doesn't either.
 * These tests are marked as fixme until the fixture sets draft_order.
 */
test.describe('Draft Flow', () => {
  test('owner can start draft @critical', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await setupAllMocks(page)

    // Login as owner
    await loginAs(page, leagueOwner)

    // Navigate to draft page (league is in 'setup' status)
    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Should show start draft button (owner only, setup status)
    await expect(page.getByTestId('start-draft-button')).toBeVisible({ timeout: 10000 })

    // Start the draft
    await page.getByTestId('start-draft-button').click()

    // Wait for the draft to start - draft-board only renders in 'drafting' status
    await expect(page.getByTestId('draft-board')).toBeVisible({ timeout: 15000 })
  })

  test('shows movie picker with search functionality', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await setupAllMocks(page)
    await loginAs(page, leagueOwner)

    // Set up drafting state directly
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Movie picker should be visible
    await expect(page.getByTestId('movie-picker')).toBeVisible({ timeout: 10000 })

    // Should show mock movies (loaded via mocked browse-movies)
    await expect(page.getByText(MOCK_MOVIES[0].title)).toBeVisible({ timeout: 10000 })

    // Test search - type "Alpha" to filter
    await page.getByTestId('movie-search-input').fill('Alpha')

    // Wait for the search mock to respond and filter results
    await expect(page.getByText(MOCK_MOVIES[0].title)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(MOCK_MOVIES[1].title)).not.toBeVisible({ timeout: 5000 })

    // Clear search
    await page.getByTestId('movie-search-input').fill('')

    // All movies should be visible again
    await expect(page.getByText(MOCK_MOVIES[1].title)).toBeVisible({ timeout: 10000 })
  })

  test('user can make a draft pick when it is their turn @critical', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await setupAllMocks(page)
    await loginAs(page, leagueOwner)

    // Set league to drafting status
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Draft board should be visible
    await expect(page.getByTestId('draft-board')).toBeVisible({ timeout: 10000 })

    // Should show "It's your turn!" since owner has draft_order=1
    await expect(page.getByText("It's your turn!")).toBeVisible({ timeout: 10000 })

    // Mock movies should be loaded - hover over first movie card to reveal draft button
    const movieCard = page.getByTestId(`movie-card-${MOCK_MOVIES[0].tmdb_id}`)
    await expect(movieCard).toBeVisible({ timeout: 10000 })
    await movieCard.hover()

    // Click the draft button (revealed on hover)
    await page.getByTestId(`draft-pick-button-${MOCK_MOVIES[0].tmdb_id}`).click()

    // Confirm pick button should appear in the fixed bottom bar
    await expect(page.getByTestId('confirm-pick-button')).toBeVisible({ timeout: 5000 })
    await page.getByTestId('confirm-pick-button').click()

    // After successful pick, the movie should appear in pick history
    await expect(page.getByTestId('draft-history')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('draft-history').getByText(MOCK_MOVIES[0].title)).toBeVisible()
  })

  test('shows waiting state when not your turn', async ({
    authedPage,
    draftReadyLeague,
  }) => {
    const page = authedPage
    await setupAllMocks(page)

    // Set league to drafting status
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    // testUser has draft_order=2, so it's NOT their turn (owner has draft_order=1)
    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Draft board should be visible
    await expect(page.getByTestId('draft-board')).toBeVisible({ timeout: 10000 })

    // Should show the owner team's pick indicator (not "It's your turn!")
    await expect(page.getByText("Owner Team's pick")).toBeVisible({ timeout: 10000 })

    // "It's your turn!" should NOT be visible
    await expect(page.getByText("It's your turn!")).not.toBeVisible()
  })
})

test.describe('Multi-User Draft (Real-time)', () => {
  // Multi-user real-time tests are inherently flaky due to
  // real-time subscription timing and multiple browser contexts.
  test.fixme('picks propagate to all users in real-time @realtime', async ({
    browser,
    draftReadyLeague,
    leagueOwner,
    testUser,
  }) => {
    // This test requires:
    // 1. draft_order set on participants (not in fixture)
    // 2. Two browser contexts connected via real-time subscriptions
    // 3. Reliable real-time propagation timing
  })

  test.fixme('turn indicator updates when pick is made', async ({
    browser,
    draftReadyLeague,
    leagueOwner,
    testUser,
    secondUser,
  }) => {
    // Requires draft_order + reliable real-time propagation.
  })
})

test.describe('Draft Progress', () => {
  test('shows progress indicator', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await loginAs(page, leagueOwner)
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Should show progress ring
    await expect(page.getByTestId('draft-progress')).toBeVisible({ timeout: 10000 })

    // Initial state should show 0 picks
    await expect(page.getByTestId('draft-progress')).toContainText(/0/)
  })

  test.fixme('progress updates after each pick', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    // Requires draft_order on participants + making a real draft pick
    // via the Edge Function which validates turn order.
  })
})
