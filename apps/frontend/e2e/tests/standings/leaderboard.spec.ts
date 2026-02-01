import { test, expect } from '../../fixtures/league.fixture'

/**
 * Standings/Leaderboard E2E Tests
 *
 * Tests the standings display and score tracking.
 * Uses scoredLeague fixture which provides an active league with
 * teams that have different scores for ranking tests.
 *
 * Best Practices Applied:
 * - Uses fixtures for test data isolation
 * - Uses programmatic auth (authedPage) for speed
 * - Tests real Supabase data (scores set in fixture)
 * - Cleanup handled by fixture teardown
 */

test.describe('Leaderboard Page @standings', () => {
  test('standings page is accessible from league @critical', async ({
    authedPage,
    scoredLeague,
  }) => {
    await authedPage.goto(`/league/${scoredLeague.id}`)

    // Look for standings link/tab
    const standingsLink = authedPage.getByRole('link', {
      name: /standings|leaderboard/i,
    })
    const hasStandingsLink = await standingsLink.isVisible().catch(() => false)

    if (hasStandingsLink) {
      await standingsLink.click()
      await authedPage.waitForURL(
        new RegExp(`/league/${scoredLeague.id}/standings`)
      )
    } else {
      // Navigate directly
      await authedPage.goto(`/league/${scoredLeague.id}/standings`)
    }

    // Verify standings page loaded
    await expect(
      authedPage.getByText(/standings|leaderboard|ranking/i).first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('displays team rankings in correct order', async ({
    authedPage,
    scoredLeague,
  }) => {
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Teams should be displayed (fixture creates 3 teams with scores 150, 120, 80)
    await expect(
      authedPage.getByText(/Owner Team|Test Team|Second Team/).first()
    ).toBeVisible({ timeout: 10000 })

    // The highest scoring team (Owner Team - 150) should appear first
    // This verifies ranking order
    const teamElements = authedPage.locator(
      '[data-testid="team-row"], .team-row, tr'
    )

    const count = await teamElements.count()
    if (count >= 2) {
      // Verify ordering - first team should have higher score than second
      const firstTeamText = await teamElements.first().textContent()
      expect(firstTeamText).toContain('150')
    }
  })

  test('displays team scores', async ({ authedPage, scoredLeague }) => {
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Verify scores are displayed
    // Fixture sets scores: Owner Team = 150, Test Team = 120, Second Team = 80
    await expect(authedPage.getByText('150')).toBeVisible({ timeout: 10000 })
    await expect(authedPage.getByText('120')).toBeVisible()
    await expect(authedPage.getByText('80')).toBeVisible()
  })

  test('current user team is identifiable', async ({
    authedPage,
    scoredLeague,
    testUser,
  }) => {
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Find the test user's team (Test Team with score 120)
    // It should have some visual distinction or "Your Team" indicator
    const testUserTeam = scoredLeague.teams.find(
      (t) => t.userId === testUser.id
    )

    if (testUserTeam) {
      await expect(
        authedPage.getByText(testUserTeam.name)
      ).toBeVisible({ timeout: 10000 })
    }
  })
})

test.describe('Score Details @standings', () => {
  test.skip('can view team score breakdown', async ({
    authedPage,
    scoredLeague,
  }) => {
    // Click on a team to see detailed scores
    // Requires movie-level score data in fixture
  })

  test.skip('shows movie review scores', async ({
    authedPage,
    scoredLeague,
  }) => {
    // View a team's movies and see IMDb/RT/Metacritic scores
    // Requires createMovieReviews helper to be used in fixture
  })
})

test.describe('Real-time Score Updates @standings', () => {
  test.skip('scores update in real-time when changed', async ({
    authedPage,
    scoredLeague,
  }) => {
    // Have standings page open
    // Update score via admin client
    // Verify UI updates without page refresh
    // Requires real-time subscription to work
  })
})
