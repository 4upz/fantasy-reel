import { test, expect } from '../../fixtures/league.fixture'

/**
 * League Movie Details E2E Tests
 *
 * Every surface that shows a movie in the league view opens the same dialog:
 * the roster, the overview timeline and the standings rosters. Only the roster
 * attaches an action to it - elsewhere you are looking at a holding, sometimes
 * someone else's, so the panel is read-only.
 *
 * The roster's own drop flow is covered in roster-drop.spec.ts; this file is
 * about the other two surfaces being reachable at all.
 *
 * Note these fixtures use synthetic tmdb_ids, so `get-movie-details` finds
 * nothing and the panel falls back to what the page already knew. That is the
 * degraded path on purpose - it proves the dialog still names the movie when
 * TMDb has no answer.
 *
 * Key UI elements:
 * - overview-movie-button: a movie anywhere on the overview timeline
 * - rail-movie-button: a movie in the desktop standings detail rail
 * - data-clickable: a movie row in the mobile standings accordion
 * - league-movie-modal: the shared dialog
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 }
const DESKTOP_VIEWPORT = { width: 1280, height: 900 }

test.describe('League Movie Details @league-movie', () => {
  test('overview movies open a read-only details dialog', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/dashboard`)

    const movieButtons = authedPage.getByTestId('overview-movie-button')
    await expect(movieButtons.first()).toBeVisible({ timeout: 10000 })

    await authedPage
      .getByRole('button', { name: `View ${rosterLeague.droppableMovieTitle}` })
      .click()

    const modal = authedPage.getByTestId('league-movie-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveCount(1)
    await expect(
      modal.getByRole('heading', { name: new RegExp(rosterLeague.droppableMovieTitle) })
    ).toBeVisible()
    await expect(modal.getByText('On your roster')).toBeVisible()

    // Managing a holding is the roster's job.
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveCount(0)

    await authedPage.getByTestId('league-modal-close').click()
    await expect(modal).toHaveCount(0)
  })

  test('standings rosters open the same dialog on desktop', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(DESKTOP_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/standings`)

    const railMovies = authedPage.getByTestId('rail-movie-button')
    await expect(railMovies.first()).toBeVisible({ timeout: 10000 })

    await railMovies.first().click()

    const modal = authedPage.getByTestId('league-movie-modal')
    await expect(modal).toBeVisible()
    // Names whose roster you are looking at, since it need not be yours.
    await expect(modal.getByText(/^On /)).toBeVisible()
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveCount(0)
  })

  test('a standings movie opens without collapsing the team it belongs to', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/standings`)

    // Expand the team whose roster holds the fixture's movies.
    const teamRow = authedPage
      .locator('[data-testid^="team-row-"]')
      .filter({ hasText: 'Test Team' })
      .first()
    await expect(teamRow).toBeVisible({ timeout: 10000 })
    await teamRow.click()

    const movieRows = authedPage.locator('[data-clickable="true"]')
    await expect(movieRows.first()).toBeVisible()
    const rowCount = await movieRows.count()

    await movieRows.first().click()

    await expect(authedPage.getByTestId('league-movie-modal')).toBeVisible()
    // The row is nested inside a clickable accordion header; without stopping
    // propagation the team would collapse out from under the dialog.
    await expect(movieRows).toHaveCount(rowCount)
  })
})
