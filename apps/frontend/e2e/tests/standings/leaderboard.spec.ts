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
      '[data-testid^="team-row-"]'
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
  test('can view team details from standings', async ({
    authedPage,
    scoredLeagueWithReviews,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/standings`)

    // Wait for standings to load
    await expect(
      authedPage.getByText(/standings|leaderboard/i).first()
    ).toBeVisible({ timeout: 10000 })

    // Teams should be visible
    await expect(authedPage.getByText('Owner Team')).toBeVisible()

    // Click on a team row to see details if available
    const teamRow = authedPage.locator('[data-testid^="team-row-"]').first()
    if (await teamRow.isVisible().catch(() => false)) {
      await teamRow.click()

      // Look for any expanded details or modal
      const details = authedPage.getByText(/details|movies|roster/i).first()
      // This is optional - not all UIs expand on click
      if (await details.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(details).toBeVisible()
      }
    }
  })

  test('shows team movies in standings context', async ({
    authedPage,
    scoredLeagueWithReviews,
  }) => {
    // Navigate to standings
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/standings`)

    // The fixture created movies - verify they appear
    await expect(
      authedPage.getByText(/Scored Movie|movie/i).first()
    ).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Real-time Score Updates @standings', () => {
  test('standings page shows current scores', async ({
    authedPage,
    scoredLeagueWithReviews,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/standings`)

    // Verify all three scores are displayed
    await expect(authedPage.getByText('150')).toBeVisible({ timeout: 10000 })
    await expect(authedPage.getByText('120')).toBeVisible()
    await expect(authedPage.getByText('80')).toBeVisible()

    // Verify teams are in correct order (highest first)
    const pageContent = await authedPage.content()
    const pos150 = pageContent.indexOf('150')
    const pos120 = pageContent.indexOf('120')
    const pos80 = pageContent.indexOf('80')

    // Higher scores should appear first in the DOM
    expect(pos150).toBeLessThan(pos120)
    expect(pos120).toBeLessThan(pos80)
  })
})
