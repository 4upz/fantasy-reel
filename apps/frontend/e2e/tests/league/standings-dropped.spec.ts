import { test, expect } from '../../fixtures/league.fixture'
import { getAdminClient } from '../../helpers/supabase.helper'

/**
 * Standings vs. Roster Agreement E2E Tests
 *
 * Regression this guards against: the standings page fetched `draft_picks`
 * without `dropped_at IS NULL`, while every other roster-shaped view filtered
 * it. A dropped movie therefore stayed on the team's standings card forever -
 * reported in production as "The Cat in the Hat shows up in standings but not
 * my roster".
 *
 * The scores were never wrong, which is what made it confusing: team_scores is
 * computed by recalculate_team_score_with_counterpicks(), which does filter
 * dropped picks. So the card listed a movie worth nothing and the header count
 * ("3 movies") disagreed with the scored/pending counts beside it.
 *
 * Uses the rosterLeague fixture: testUser holds three draft picks, one of which
 * is droppable.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 }

/** Draft picks the rosterLeague fixture puts on the testUser roster. */
const HELD_MOVIE_COUNT = 3

test.describe('Standings drops @standings', () => {
  test('a dropped movie leaves the standings card and its movie count', async ({
    authedPage,
    rosterLeague,
  }) => {
    // Drop straight through the database rather than the roster UI: this test is
    // about what standings does with a dropped pick, not about the drop flow
    // (roster-drop.spec.ts owns that).
    const client = getAdminClient()
    const { error } = await client
      .from('draft_picks')
      .update({ dropped_at: new Date().toISOString() })
      .eq('id', rosterLeague.droppableDraftPickId)
    expect(error).toBeNull()

    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/standings`)

    const row = authedPage.getByTestId(`team-row-${rosterLeague.testUserTeamId}`)
    await expect(row).toBeVisible({ timeout: 10000 })

    // The collapsed row's own count, which reads off the fetched picks.
    await expect(row).toContainText(`${HELD_MOVIE_COUNT - 1} movies`)

    // Expand the team to see the movie list itself.
    await row.getByRole('button').first().click()
    await expect(row.getByTestId('movie-score-card-draft')).toHaveCount(HELD_MOVIE_COUNT - 1)
    await expect(
      row.getByRole('button', { name: `View ${rosterLeague.droppableMovieTitle}` })
    ).toHaveCount(0)

    // The two movies still held are untouched.
    await expect(
      row.getByRole('button', { name: `View ${rosterLeague.releasedMovieTitle}` })
    ).toBeVisible()
    await expect(
      row.getByRole('button', { name: `View ${rosterLeague.counterpickedMovieTitle}` })
    ).toBeVisible()
  })

  test('standings and roster list the same movies for the same team', async ({
    authedPage,
    rosterLeague,
  }) => {
    const client = getAdminClient()
    await client
      .from('draft_picks')
      .update({ dropped_at: new Date().toISOString() })
      .eq('id', rosterLeague.droppableDraftPickId)

    await authedPage.setViewportSize(MOBILE_VIEWPORT)

    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })
    const rosterCount = await authedPage.getByTestId('roster-movie-card').count()

    await authedPage.goto(`/league/${rosterLeague.id}/standings`)
    const row = authedPage.getByTestId(`team-row-${rosterLeague.testUserTeamId}`)
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.getByRole('button').first().click()
    const standingsCount = await row.getByTestId('movie-score-card-draft').count()

    expect(standingsCount).toBe(rosterCount)
  })
})
