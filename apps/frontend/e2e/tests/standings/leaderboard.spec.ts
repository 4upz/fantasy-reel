import { test, expect } from '../../fixtures/league.fixture'

/**
 * Standings/Leaderboard E2E Tests
 *
 * Tests the standings display and score tracking.
 * Uses scoredLeague fixture which provides an active league with
 * teams that have different scores for ranking tests.
 *
 * Key UI elements:
 * - team-row-{id}: Individual team standing cards (TeamStandingCard)
 *
 * IMPORTANT: formatFantasyPoints() renders positives unsigned - 150 displays as
 * "150". Only negatives keep a sign; colour carries it otherwise.
 *
 * Fixture scores:
 * - Owner Team: 150
 * - Test Team: 120
 * - Second Team: 80
 */

test.describe('Leaderboard Page @standings', () => {
  test('standings page is accessible from league @critical', async ({
    authedPage,
    scoredLeague,
  }) => {
    // Navigate directly to standings page
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Verify standings page loaded - look for team rows
    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })
  })

  test('displays team rankings in correct order', async ({
    authedPage,
    scoredLeague,
  }) => {
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Teams should be displayed
    const teamElements = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamElements.first()).toBeVisible({ timeout: 10000 })

    const count = await teamElements.count()
    expect(count).toBeGreaterThanOrEqual(2)

    // Verify ordering: first team should have higher score than second
    const firstTeamText = await teamElements.nth(0).textContent()
    const secondTeamText = await teamElements.nth(1).textContent()

    // The highest score team (Owner Team, 150) should be first
    expect(firstTeamText).toContain('150')
    expect(secondTeamText).toContain('120')
  })

  test('displays team scores', async ({ authedPage, scoredLeague }) => {
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Wait for standings to load
    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Verify scores are displayed (unsigned, per formatFantasyPoints)
    await expect(authedPage.getByText('150', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('120', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('80', { exact: true })).toBeVisible()
  })

  test('current user team is identifiable', async ({
    authedPage,
    scoredLeague,
    testUser,
  }) => {
    await authedPage.goto(`/league/${scoredLeague.id}/standings`)

    // Find the test user's team row
    const testUserTeam = scoredLeague.teams.find(
      (t) => t.userId === testUser.id
    )

    if (testUserTeam) {
      // The team row should have a "You" indicator for the current user.
      // Scope the name to the row - the desktop detail rail names it too.
      const teamRow = authedPage.getByTestId(`team-row-${testUserTeam.teamId}`)
      await expect(teamRow).toBeVisible({ timeout: 10000 })
      await expect(teamRow.getByText(testUserTeam.name)).toBeVisible()
      await expect(teamRow.getByText('You')).toBeVisible()
    }
  })
})

test.describe('Score Details @standings', () => {
  // Tapping a row to reveal its roster is the mobile shape. Above lg the same
  // detail opens in the sticky rail instead - covered separately below.
  test.use({ viewport: { width: 390, height: 844 } })

  test('can view team details from standings', async ({
    authedPage,
    scoredLeagueWithReviews,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/standings`)

    // Wait for standings to load
    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Click on a team row to expand details
    await teamRows.first().click()

    // After clicking, the expanded section should show movie details
    // The TeamStandingCard expands to show MovieScoreCard components
    // Scope to standings container to avoid matching hidden sidenav elements
    const standingsContainer = authedPage.getByTestId('standings-container')
    await expect(
      standingsContainer.getByText(/Scored Movie/i).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows team movies in standings context', async ({
    authedPage,
    scoredLeagueWithReviews,
  }) => {
    // Navigate to standings
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/standings`)

    // Wait for team rows to load
    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Click to expand a team row
    await teamRows.first().click()

    // The fixture created movies - "Scored Movie Alpha" etc.
    // After expanding, the movie names should be visible
    await expect(
      authedPage.getByText(/Scored Movie/i).first()
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Score Ordering @standings', () => {
  test('standings page shows teams in descending score order', async ({
    authedPage,
    scoredLeagueWithReviews,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/standings`)

    // Wait for standings to load
    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Verify all three scores are displayed (unsigned, per formatFantasyPoints)
    await expect(authedPage.getByText('150', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('120', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('80', { exact: true })).toBeVisible()

    // Verify teams are in correct order by checking team-row DOM order
    const count = await teamRows.count()
    expect(count).toBeGreaterThanOrEqual(3)

    const firstRowText = await teamRows.nth(0).textContent()
    const secondRowText = await teamRows.nth(1).textContent()
    const thirdRowText = await teamRows.nth(2).textContent()

    // Higher scores should appear first
    expect(firstRowText).toContain('150')
    expect(secondRowText).toContain('120')
    expect(thirdRowText).toContain('80')
  })
})

test.describe('Full Roster Display @standings', () => {
  // The accordion only exists below lg; desktop puts the roster in the rail.
  test.use({ viewport: { width: 390, height: 844 } })

  // The expanded panel is a flat list - how a movie was acquired is carried by the
  // poster badge (and its data-testid), not by a section header.
  test('expanded team shows its draft picks and points breakdown', async ({
    authedPage,
    scoredLeagueWithFullRoster,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithFullRoster.id}/standings`)

    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Expand the first team
    await teamRows.first().click()

    // Scope to the expanded team row to avoid matching other cards
    await expect(
      teamRows.first().getByTestId('movie-score-card-draft').first()
    ).toBeVisible({ timeout: 5000 })
    await expect(teamRows.first().getByText('Draft', { exact: false }).first()).toBeVisible()
  })

  test('expanded team with pickup shows Pickups section', async ({
    authedPage,
    scoredLeagueWithFullRoster,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithFullRoster.id}/standings`)

    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Find Test Team by its data-testid (hasText: 'Test Team' matches multiple
    // cards because counterpick badges show "vs. Test Team" in other cards)
    const testTeamId = scoredLeagueWithFullRoster.teams[1].teamId
    const testTeamRow = authedPage.getByTestId(`team-row-${testTeamId}`)
    await expect(testTeamRow).toBeVisible({ timeout: 5000 })
    await testTeamRow.click()

    // Verify a pickup-badged movie row appears within this team's card
    await expect(
      testTeamRow.getByTestId('movie-score-card-pickup').first()
    ).toBeVisible({ timeout: 5000 })

    // Verify the pickup movie title is shown within this team's card
    await expect(
      testTeamRow.getByText(scoredLeagueWithFullRoster.pickupMovieTitle)
    ).toBeVisible()
  })

  test('expanded team with counterpick shows Counterpicks section', async ({
    authedPage,
    scoredLeagueWithFullRoster,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithFullRoster.id}/standings`)

    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Find Second Team by its data-testid for precision
    const secondTeamId = scoredLeagueWithFullRoster.teams[2].teamId
    const secondTeamRow = authedPage.getByTestId(`team-row-${secondTeamId}`)
    await expect(secondTeamRow).toBeVisible({ timeout: 5000 })
    await secondTeamRow.click()

    // Verify a counterpick-badged movie row appears within this team's card
    await expect(
      secondTeamRow.getByTestId('movie-score-card-counterpick').first()
    ).toBeVisible({ timeout: 5000 })

    // Verify the counterpick movie title is shown within this team's card
    await expect(
      secondTeamRow.getByText(scoredLeagueWithFullRoster.counterpickMovieTitle)
    ).toBeVisible()
  })

  test('team header shows combined movie count from drafts and pickups', async ({
    authedPage,
    scoredLeagueWithFullRoster,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithFullRoster.id}/standings`)

    const teamRows = authedPage.locator('[data-testid^="team-row-"]')
    await expect(teamRows.first()).toBeVisible({ timeout: 10000 })

    // Test Team has 1 draft pick + 1 pickup = "2 movies"
    const testTeamId = scoredLeagueWithFullRoster.teams[1].teamId
    const testTeamRow = authedPage.getByTestId(`team-row-${testTeamId}`)
    await expect(testTeamRow.getByText('2 movies')).toBeVisible()
  })
})

test.describe('Detail Rail @standings', () => {
  // Above lg the roster opens beside the table instead of inside the row.
  test.use({ viewport: { width: 1280, height: 900 } })

  test('rail defaults to the current user team and follows selection', async ({
    authedPage,
    scoredLeagueWithFullRoster,
    testUser,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithFullRoster.id}/standings`)

    const rail = authedPage.getByTestId('team-detail-rail')
    await expect(rail).toBeVisible({ timeout: 10000 })

    // Defaults to your own team - the one you came to check
    const ownTeam = scoredLeagueWithFullRoster.teams.find((t) => t.userId === testUser.id)
    if (ownTeam) {
      await expect(rail.getByText(ownTeam.name)).toBeVisible()
    }

    // Selecting another row refills the rail
    const otherTeam = scoredLeagueWithFullRoster.teams.find((t) => t.userId !== testUser.id)
    if (otherTeam) {
      await authedPage.getByTestId(`team-row-${otherTeam.teamId}`).click()
      await expect(rail.getByText(otherTeam.name)).toBeVisible({ timeout: 5000 })
    }
  })

  test('rail lists the selected team roster', async ({
    authedPage,
    scoredLeagueWithFullRoster,
  }) => {
    await authedPage.goto(`/league/${scoredLeagueWithFullRoster.id}/standings`)

    const testTeamId = scoredLeagueWithFullRoster.teams[1].teamId
    await authedPage.getByTestId(`team-row-${testTeamId}`).click()

    const rail = authedPage.getByTestId('team-detail-rail')
    await expect(
      rail.getByText(scoredLeagueWithFullRoster.pickupMovieTitle)
    ).toBeVisible({ timeout: 5000 })
  })
})
