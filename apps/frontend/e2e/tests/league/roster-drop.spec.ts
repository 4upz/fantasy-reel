import { test, expect } from '../../fixtures/league.fixture'
import { waitForToast } from '../../helpers/ui.helper'
import { getAdminClient } from '../../helpers/supabase.helper'

/**
 * Roster Drop Flow E2E Tests
 *
 * Covers dropping a movie from the roster end to end, plus the states where a
 * held movie cannot be dropped.
 *
 * The regression these guard against: the drop control used to be
 * `opacity-0 group-hover:opacity-100`, so on a touch device - which never
 * hovers - it was fully transparent while still occupying a tappable corner of
 * the poster. Teams could not find it and sat on movies they meant to drop,
 * which took a manual database repair to unwind.
 *
 * Note `toBeVisible()` alone does NOT catch that bug: Playwright treats an
 * `opacity: 0` element as visible because it still has a bounding box. The
 * touch-reachability test asserts computed opacity directly.
 *
 * Uses the rosterLeague fixture, whose testUser roster holds one movie in each
 * state: droppable (unreleased), released, and counterpicked.
 *
 * Getting to the roster is league-tabs.spec.ts's job - it already asserts that
 * an active league puts Roster on the mobile bar and Draft in the "More" sheet,
 * so this file navigates straight to the page and stays about the drop itself.
 *
 * Key UI elements:
 * - drop-movie-button: the per-card drop control
 * - roster-team-name: roster page heading, used as the page-loaded signal
 */

/** Minimum comfortable touch target, per the WCAG 2.5.5 / Apple HIG guidance. */
const MIN_TAP_TARGET_PX = 44

const MOBILE_VIEWPORT = { width: 390, height: 844 }

test.describe('Roster Drop Flow @roster', () => {
  test('drop control is reachable on a touch viewport without hovering', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    const dropButton = authedPage.getByTestId('drop-movie-button')
    await expect(dropButton).toHaveCount(1)
    await expect(dropButton).toBeVisible()

    // The actual regression guard. No hover has happened, so a hover-gated
    // control would report opacity "0" here while still passing toBeVisible().
    const presentation = await dropButton.evaluate((el) => {
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return {
        opacity: style.opacity,
        visibility: style.visibility,
        width: rect.width,
        height: rect.height,
      }
    })

    expect(Number(presentation.opacity)).toBeGreaterThan(0.5)
    expect(presentation.visibility).toBe('visible')
    expect(presentation.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX)
    expect(presentation.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX)

    // Screen reader users need the control named, not just drawn.
    await expect(dropButton).toHaveAccessibleName(
      `Drop ${rosterLeague.droppableMovieTitle}`
    )
  })

  test('drops a movie end to end and records it', async ({ authedPage, rosterLeague }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await expect(authedPage.getByText('Drops: 0/2 used')).toBeVisible()
    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.droppableMovieTitle })
    ).toBeVisible()

    await authedPage.getByTestId('drop-movie-button').click()

    // Confirmation names the movie, so a mis-tap on a dense grid is recoverable.
    await expect(
      authedPage.getByText(`Drop ${rosterLeague.droppableMovieTitle}?`)
    ).toBeVisible()
    await authedPage.getByRole('button', { name: 'Drop', exact: true }).click()

    await waitForToast(authedPage, new RegExp(`Dropped ${rosterLeague.droppableMovieTitle}`))

    // The card goes away and the allowance ticks up without a reload.
    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.droppableMovieTitle })
    ).toHaveCount(0)
    await expect(authedPage.getByText('Drops: 1/2 used')).toBeVisible()

    // The drop is persisted, not just hidden client side.
    const client = getAdminClient()
    const { data: pick } = await client
      .from('draft_picks')
      .select('dropped_at')
      .eq('id', rosterLeague.droppableDraftPickId)
      .single()
    expect(pick?.dropped_at).not.toBeNull()

    const { data: drops } = await client
      .from('team_drops')
      .select('draft_pick_id')
      .eq('team_id', rosterLeague.testUserTeamId)
    expect(drops).toHaveLength(1)
    expect(drops?.[0].draft_pick_id).toBe(rosterLeague.droppableDraftPickId)
  })

  test('keeping the movie cancels the drop', async ({ authedPage, rosterLeague }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await authedPage.getByTestId('drop-movie-button').click()
    await expect(
      authedPage.getByText(`Drop ${rosterLeague.droppableMovieTitle}?`)
    ).toBeVisible()

    await authedPage.getByRole('button', { name: 'Keep' }).click()

    // Back to the drop control, movie untouched.
    await expect(authedPage.getByTestId('drop-movie-button')).toBeVisible()
    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.droppableMovieTitle })
    ).toBeVisible()
    await expect(authedPage.getByText('Drops: 0/2 used')).toBeVisible()

    const client = getAdminClient()
    const { data: drops } = await client
      .from('team_drops')
      .select('id')
      .eq('team_id', rosterLeague.testUserTeamId)
    expect(drops).toHaveLength(0)
  })

  test('a counterpicked movie is locked and says why', async ({ authedPage, rosterLeague }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.counterpickedMovieTitle })
    ).toBeVisible()

    // Explained rather than silently missing - the gap that left a team unable
    // to tell a locked movie from one it had simply never tried to drop.
    await expect(authedPage.getByText('Counterpicked — locked')).toBeVisible()

    // Only the droppable movie keeps a control: not the counterpicked one, and
    // not the released one.
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveCount(1)
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveAccessibleName(
      `Drop ${rosterLeague.droppableMovieTitle}`
    )
  })

  test('a released movie offers no drop control', async ({ authedPage, rosterLeague }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.releasedMovieTitle })
    ).toBeVisible()

    // A released movie is self evidently past dropping, so it carries no lock
    // line either - that noise would land on most of the grid late in a season.
    await expect(authedPage.getByText('Counterpick bid open — locked')).toHaveCount(0)
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveCount(1)
  })
})
