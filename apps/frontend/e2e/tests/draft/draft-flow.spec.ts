import { test, expect, loginAs } from '../../fixtures/league.fixture'
import { setupAllMocks, MOCK_MOVIES } from '../../helpers/mock-api.helper'
import { updateLeagueStatus, waitForRealtimeReady } from '../../helpers/supabase.helper'

/**
 * Draft flow E2E tests
 * Tests the complete draft experience including multi-user real-time scenarios
 */
test.describe('Draft Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupAllMocks(page)
  })

  test('owner can start draft @critical', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage

    // Login as owner
    await loginAs(page, leagueOwner)

    // Navigate to draft page
    await page.goto(`/league/${draftReadyLeague.id}/draft`)
    await waitForRealtimeReady(page)

    // Should show start draft button (owner only)
    await expect(page.getByTestId('start-draft-button')).toBeVisible()

    // Start the draft
    await page.click('[data-testid="start-draft-button"]')

    // Confirm if there's a confirmation dialog
    const confirmButton = page.getByTestId('confirm-start-draft')
    const confirmVisible = await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)
    if (confirmVisible) {
      await confirmButton.click()
    }

    // Wait for the draft start action to complete
    await page.waitForLoadState('networkidle')

    // Should show draft board
    await expect(page.getByTestId('draft-board')).toBeVisible({ timeout: 10000 })

    // Status should change to drafting (allow time for state propagation)
    await expect(page.getByText(/drafting/i)).toBeVisible({ timeout: 15000 })
  })

  test('shows movie picker with search functionality', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await loginAs(page, leagueOwner)

    // Start draft first
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)
    await waitForRealtimeReady(page)

    // Movie picker should be visible
    await expect(page.getByTestId('movie-picker')).toBeVisible()

    // Should show mock movies
    await expect(page.getByText(MOCK_MOVIES[0].title)).toBeVisible()

    // Test search
    await page.fill('[data-testid="movie-search-input"]', 'Alpha')

    // Wait for debounced search (300ms + buffer)
    await page.waitForTimeout(500)

    // Should filter to matching movie
    await expect(page.getByText(MOCK_MOVIES[0].title)).toBeVisible()
    await expect(page.getByText(MOCK_MOVIES[1].title)).not.toBeVisible()

    // Clear search
    await page.fill('[data-testid="movie-search-input"]', '')
    await page.waitForTimeout(500)

    // All movies should be visible again
    await expect(page.getByText(MOCK_MOVIES[1].title)).toBeVisible()
  })

  test('user can make a draft pick when it is their turn @critical', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await loginAs(page, leagueOwner)

    // Set up drafting state
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)
    await waitForRealtimeReady(page)

    // Should show "Your turn" indicator (owner picks first)
    await expect(page.getByText(/your turn/i)).toBeVisible({ timeout: 10000 })

    // Click on a movie card
    await page.click(`[data-testid="movie-card-${MOCK_MOVIES[0].tmdb_id}"]`)

    // Pick button should be available
    await expect(page.getByTestId('draft-pick-button')).toBeVisible()
    await page.click('[data-testid="draft-pick-button"]')

    // Wait for pick action to complete
    await page.waitForLoadState('networkidle')

    // Pick should appear in draft history
    await expect(page.getByTestId('draft-history')).toContainText(MOCK_MOVIES[0].title, {
      timeout: 10000,
    })

    // Picked movie should no longer be in picker
    await expect(page.getByTestId(`movie-card-${MOCK_MOVIES[0].tmdb_id}`)).not.toBeVisible()
  })

  test('shows waiting state when not your turn', async ({
    browser,
    draftReadyLeague,
    testUser,
    leagueOwner,
  }) => {
    // Update league to drafting
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    // Create context for non-owner user
    const userContext = await browser.newContext()
    const userPage = await userContext.newPage()

    await setupAllMocks(userPage)
    await loginAs(userPage, testUser)

    await userPage.goto(`/league/${draftReadyLeague.id}/draft`)
    await waitForRealtimeReady(userPage)

    // Should show waiting indicator (owner picks first in snake draft)
    await expect(userPage.getByText(/waiting for|not your turn/i)).toBeVisible({
      timeout: 10000,
    })

    // Pick button should be disabled or not visible
    const pickButton = userPage.getByTestId('draft-pick-button')
    const pickVisible = await pickButton.isVisible({ timeout: 1000 }).catch(() => false)
    if (pickVisible) {
      await expect(pickButton).toBeDisabled()
    }

    await userContext.close()
  })
})

test.describe('Multi-User Draft (Real-time)', () => {
  test('picks propagate to all users in real-time @realtime', async ({
    browser,
    draftReadyLeague,
    leagueOwner,
    testUser,
  }) => {
    // Update league to drafting
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    // Create separate browser contexts for each user
    const ownerContext = await browser.newContext()
    const userContext = await browser.newContext()

    const ownerPage = await ownerContext.newPage()
    const userPage = await userContext.newPage()

    // Setup mocks for both pages
    await setupAllMocks(ownerPage)
    await setupAllMocks(userPage)

    // Login both users
    await loginAs(ownerPage, leagueOwner)
    await loginAs(userPage, testUser)

    // Navigate both to draft page
    await ownerPage.goto(`/league/${draftReadyLeague.id}/draft`)
    await userPage.goto(`/league/${draftReadyLeague.id}/draft`)

    // Wait for both to load and real-time connections to be ready
    await expect(ownerPage.getByTestId('draft-board')).toBeVisible()
    await expect(userPage.getByTestId('draft-board')).toBeVisible()
    await waitForRealtimeReady(ownerPage)
    await waitForRealtimeReady(userPage)

    // Owner makes a pick
    await ownerPage.click(`[data-testid="movie-card-${MOCK_MOVIES[0].tmdb_id}"]`)
    await ownerPage.click('[data-testid="draft-pick-button"]')

    // Wait for pick action to complete
    await ownerPage.waitForLoadState('networkidle')

    // Pick should appear in both users' draft history (real-time)
    await expect(ownerPage.getByTestId('draft-history')).toContainText(
      MOCK_MOVIES[0].title,
      { timeout: 15000 }
    )
    await expect(userPage.getByTestId('draft-history')).toContainText(
      MOCK_MOVIES[0].title,
      { timeout: 15000 }
    )

    // User should now see "Your turn" (snake draft: owner -> user)
    await expect(userPage.getByText(/your turn/i)).toBeVisible({ timeout: 10000 })

    // Clean up contexts
    await ownerContext.close()
    await userContext.close()
  })

  test('turn indicator updates when pick is made', async ({
    browser,
    draftReadyLeague,
    leagueOwner,
    testUser,
    secondUser,
  }) => {
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()

    await setupAllMocks(ownerPage)
    await loginAs(ownerPage, leagueOwner)

    await ownerPage.goto(`/league/${draftReadyLeague.id}/draft`)
    await waitForRealtimeReady(ownerPage)

    // Verify owner sees their turn
    await expect(ownerPage.getByText(/your turn/i)).toBeVisible()

    // Get pick order queue
    const pickOrderQueue = ownerPage.getByTestId('pick-order-queue')
    await expect(pickOrderQueue).toBeVisible()

    // First position should highlight owner
    await expect(pickOrderQueue.locator('[data-current="true"]')).toContainText(/owner/i)

    // Make a pick
    await ownerPage.click(`[data-testid="movie-card-${MOCK_MOVIES[0].tmdb_id}"]`)
    await ownerPage.click('[data-testid="draft-pick-button"]')

    // Wait for pick action to complete
    await ownerPage.waitForLoadState('networkidle')

    // Wait for pick to process
    await expect(ownerPage.getByTestId('draft-history')).toContainText(
      MOCK_MOVIES[0].title,
      { timeout: 15000 }
    )

    // Turn should move to next user
    await expect(ownerPage.getByText(/waiting for/i)).toBeVisible({ timeout: 10000 })

    await ownerContext.close()
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
    await waitForRealtimeReady(page)

    // Should show progress ring or indicator
    await expect(page.getByTestId('draft-progress')).toBeVisible()

    // Initial state should show 0 picks
    await expect(page.getByTestId('draft-progress')).toContainText(/0/)
  })

  test('progress updates after each pick', async ({
    authenticatedPage,
    draftReadyLeague,
    leagueOwner,
  }) => {
    const page = authenticatedPage
    await loginAs(page, leagueOwner)
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')

    await page.goto(`/league/${draftReadyLeague.id}/draft`)
    await waitForRealtimeReady(page)

    // Get initial progress
    const progress = page.getByTestId('draft-progress')
    await expect(progress).toContainText(/0/)

    // Make a pick
    await page.click(`[data-testid="movie-card-${MOCK_MOVIES[0].tmdb_id}"]`)
    await page.click('[data-testid="draft-pick-button"]')

    // Wait for pick action to complete
    await page.waitForLoadState('networkidle')

    // Progress should update
    await expect(progress).toContainText(/1/, { timeout: 15000 })
  })
})
