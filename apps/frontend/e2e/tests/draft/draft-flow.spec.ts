import { test, expect } from '../../fixtures/league.fixture'
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
 * - movie-card-{tmdb_id}: Individual movie cards (click opens detail modal)
 * - draft-movie-button: "Draft This Movie" button inside the movie detail modal
 * - draft-history: Pick history section (only shown when picks exist)
 * - draft-progress: Progress ring showing picks made / total
 * - pick-order-queue: Shows upcoming pick order
 *
 * NOTE: Turn-based assertions (your turn, waiting state, making picks) rely on
 * the draft_order the draftReadyLeague fixture sets: owner=1, testUser=2,
 * secondUser=3. The tests still marked fixme need something the fixture can't
 * provide: real-time propagation across two contexts, or a real Edge Function
 * pick that passes turn validation.
 */
test.describe('Draft Flow', () => {
  test('owner can start draft @critical', async ({ leagueOwnerPage, draftReadyLeague }) => {
    const page = leagueOwnerPage
    await setupAllMocks(page)

    // Navigate to draft page (league is in 'setup' status)
    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Should show start draft button (owner only, setup status)
    await expect(page.getByTestId('start-draft-button')).toBeVisible({ timeout: 10000 })

    // Start the draft
    await page.getByTestId('start-draft-button').click()

    // Wait for the draft to start - draft-board only renders in 'drafting' status
    await expect(page.getByTestId('draft-board')).toBeVisible({ timeout: 15000 })
  })

  test('shows movie picker with search functionality', async ({ leagueOwnerPage, draftReadyLeague }) => {
    const page = leagueOwnerPage
    await setupAllMocks(page)

    // Set up drafting state directly
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Movie picker should be visible
    await expect(page.getByTestId('movie-picker')).toBeVisible({ timeout: 10000 })

    // Should show mock movies (loaded via mocked browse-movies)
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[0].tmdb_id}`)).toBeVisible({ timeout: 10000 })

    // Test search - type "Alpha" to filter
    await page.getByTestId('movie-search-input').fill('Alpha')

    // Wait for the search mock to respond and filter results
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[0].tmdb_id}`)).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[1].tmdb_id}`)).not.toBeVisible({ timeout: 5000 })

    // Clear search
    await page.getByTestId('movie-search-input').fill('')

    // All movies should be visible again
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[1].tmdb_id}`)).toBeVisible({ timeout: 10000 })
  })

  test('user can make a draft pick when it is their turn @critical', async ({
    leagueOwnerPage,
    draftReadyLeague,
  }) => {
    const page = leagueOwnerPage
    await setupAllMocks(page)

    // Set league to drafting status
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Draft board should be visible
    await expect(page.getByTestId('draft-board')).toBeVisible({ timeout: 10000 })

    // Should show "It's your turn!" since owner has draft_order=1
    await expect(page.getByText("It's your turn!")).toBeVisible({ timeout: 10000 })

    // Click a movie card to open the detail modal
    const movieCard = page.getByTestId(`movie-card-${MOCK_MOVIES[0].tmdb_id}`)
    await expect(movieCard).toBeVisible({ timeout: 10000 })
    await movieCard.click()

    // Draft button should be visible in the modal (it's our turn)
    await expect(page.getByTestId('draft-movie-button')).toBeVisible({ timeout: 5000 })
    await page.getByTestId('draft-movie-button').click()

    // After successful pick, the movie should appear in pick history.
    // draft-history renders PickHistory twice (desktop + mobile collapsible),
    // so filter to the copy visible at the current viewport.
    await expect(page.getByTestId('draft-history')).toBeVisible({ timeout: 15000 })
    await expect(
      page.getByTestId('draft-history').getByText(MOCK_MOVIES[0].title).filter({ visible: true })
    ).toBeVisible()
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
  test.fixme('picks propagate to all users in real-time @realtime', async () => {
    // This test requires:
    // 1. Two browser contexts connected via real-time subscriptions
    // 2. Reliable real-time propagation timing
  })

  test.fixme('turn indicator updates when pick is made', async () => {
    // Requires reliable real-time propagation across contexts.
  })
})

test.describe('Draft Progress', () => {
  test('shows progress indicator', async ({ leagueOwnerPage, draftReadyLeague }) => {
    const page = leagueOwnerPage
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)

    // Should show progress ring
    await expect(page.getByTestId('draft-progress')).toBeVisible({ timeout: 10000 })

    // Initial state should show 0 picks
    await expect(page.getByTestId('draft-progress')).toContainText(/0/)
  })

  test.fixme('progress updates after each pick', async () => {
    // Requires making a real draft pick via the Edge Function,
    // which validates turn order.
  })
})
