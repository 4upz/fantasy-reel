import { test, expect } from '../../fixtures/league.fixture'
import { waitForToast } from '../../helpers/ui.helper'
import { getAdminClient } from '../../helpers/supabase.helper'

/**
 * Roster Drop Flow E2E Tests
 *
 * Covers dropping a movie from the roster end to end, plus every state where a
 * held movie cannot be dropped.
 *
 * Two regressions these guard against:
 *
 * 1. The drop control used to be `opacity-0 group-hover:opacity-100`, so on a
 *    touch device - which never hovers - it was fully transparent while still
 *    occupying a tappable corner of the poster. Teams could not find it and sat
 *    on movies they meant to drop, which took a manual database repair to
 *    unwind. Note `toBeVisible()` alone does NOT catch that: Playwright treats
 *    an `opacity: 0` element as visible because it still has a bounding box, so
 *    the reachability test asserts computed opacity directly.
 *
 * 2. A movie that could not be dropped rendered no control at all, so it looked
 *    identical to one the player had simply never tried to drop. Every held
 *    movie now carries a control, and a locked one explains itself on click.
 *
 * Uses the rosterLeague fixture, whose testUser roster holds one movie in each
 * state: droppable (unreleased), released, and counterpicked.
 *
 * Getting to the roster is league-tabs.spec.ts's job - it already asserts that
 * an active league puts Roster on the mobile bar and Draft in the "More" sheet,
 * so this file navigates straight to the page and stays about the drop itself.
 *
 * Key UI elements:
 * - drop-movie-button: the per-card drop control (data-locked marks locked ones)
 * - drop-movie-modal: the confirm/explain dialog
 * - drop-blocker-headline: the reason line inside a locked movie's dialog
 * - roster-team-name: roster page heading, used as the page-loaded signal
 */

/** Minimum comfortable touch target, per the WCAG 2.5.5 / Apple HIG guidance. */
const MIN_TAP_TARGET_PX = 44

const MOBILE_VIEWPORT = { width: 390, height: 844 }

/** Every movie the rosterLeague fixture puts on the testUser roster. */
const HELD_MOVIE_COUNT = 3

test.describe('Roster Drop Flow @roster', () => {
  test('every held movie offers a reachable control on a touch viewport', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    const dropButtons = authedPage.getByTestId('drop-movie-button')
    await expect(dropButtons).toHaveCount(HELD_MOVIE_COUNT)

    // The actual regression guard. No hover has happened, so a hover-gated
    // control would report opacity "0" here while still passing toBeVisible().
    for (let i = 0; i < HELD_MOVIE_COUNT; i++) {
      const presentation = await dropButtons.nth(i).evaluate((el) => {
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
    }

    // Screen reader users need each control named, and a locked one named for
    // what it actually does - explain, not drop.
    await expect(
      authedPage.getByRole('button', { name: `Drop ${rosterLeague.droppableMovieTitle}` })
    ).toBeVisible()
    await expect(
      authedPage.getByRole('button', {
        name: `Why ${rosterLeague.counterpickedMovieTitle} cannot be dropped`,
      })
    ).toBeVisible()
  })

  test('the dialog spells out the cost before dropping, and the drop is recorded', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await expect(authedPage.getByTestId('drops-summary')).toHaveText('Drops: 0/2 used')

    await authedPage
      .getByRole('button', { name: `Drop ${rosterLeague.droppableMovieTitle}` })
      .click()

    // A drop is irreversible and spends a scarce allowance, so the dialog has
    // to say both before the player can confirm.
    const modal = authedPage.getByTestId('drop-movie-modal')
    await expect(modal).toBeVisible()
    // exact, because the title also appears inside the "leaves your roster" line.
    await expect(
      modal.getByText(rosterLeague.droppableMovieTitle, { exact: true })
    ).toBeVisible()
    await expect(authedPage.getByTestId('drops-after-line')).toContainText('1 left')
    await expect(modal.getByText(/cannot be undone/i)).toBeVisible()
    await expect(modal.getByText(/any team can bid on it/i)).toBeVisible()

    await authedPage.getByTestId('drop-modal-confirm').click()

    await waitForToast(authedPage, new RegExp(`Dropped ${rosterLeague.droppableMovieTitle}`))

    // The card goes away and the allowance ticks up without a reload.
    await expect(modal).toHaveCount(0)
    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.droppableMovieTitle })
    ).toHaveCount(0)
    await expect(authedPage.getByTestId('drops-summary')).toHaveText('Drops: 1/2 used')

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

    await authedPage
      .getByRole('button', { name: `Drop ${rosterLeague.droppableMovieTitle}` })
      .click()
    await expect(authedPage.getByTestId('drop-movie-modal')).toBeVisible()

    await authedPage.getByTestId('drop-modal-dismiss').click()

    // Back to the roster, movie untouched.
    await expect(authedPage.getByTestId('drop-movie-modal')).toHaveCount(0)
    await expect(
      authedPage.getByRole('heading', { name: rosterLeague.droppableMovieTitle })
    ).toBeVisible()
    await expect(authedPage.getByTestId('drops-summary')).toHaveText('Drops: 0/2 used')

    const client = getAdminClient()
    const { data: drops } = await client
      .from('team_drops')
      .select('id')
      .eq('team_id', rosterLeague.testUserTeamId)
    expect(drops).toHaveLength(0)
  })

  test('a counterpicked movie names the team that locked it', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await authedPage
      .getByRole('button', {
        name: `Why ${rosterLeague.counterpickedMovieTitle} cannot be dropped`,
      })
      .click()

    // Explained rather than silently missing - the gap that left a team unable
    // to tell a locked movie from one it had simply never tried to drop.
    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText('Owner Team')
    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText(
      rosterLeague.counterpickedMovieTitle
    )

    // A dialog that cannot drop must not offer a drop.
    await expect(authedPage.getByTestId('drop-modal-confirm')).toHaveCount(0)
  })

  test('a released movie explains that it has already opened', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await authedPage
      .getByRole('button', { name: `Why ${rosterLeague.releasedMovieTitle} cannot be dropped` })
      .click()

    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText(
      'has already opened'
    )
    await expect(authedPage.getByTestId('drop-modal-confirm')).toHaveCount(0)
  })

  test('an exhausted drop allowance explains itself on the droppable movie', async ({
    authedPage,
    rosterLeague,
  }) => {
    // Spend the allowance without touching the roster. get_team_drop_count just
    // counts team_drops rows, so pointing them at picks that are still held
    // exercises the "no drops left" branch while leaving all three cards on the
    // page. The check constraint wants exactly one source id per row.
    const client = getAdminClient()
    const { data: picks } = await client
      .from('draft_picks')
      .select('id, movie_id')
      .eq('team_id', rosterLeague.testUserTeamId)
      .neq('id', rosterLeague.droppableDraftPickId)

    expect(picks?.length).toBeGreaterThanOrEqual(2)
    await client.from('team_drops').insert(
      (picks ?? []).slice(0, 2).map((pick) => ({
        team_id: rosterLeague.testUserTeamId,
        movie_id: pick.movie_id,
        draft_pick_id: pick.id,
      }))
    )

    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await expect(authedPage.getByTestId('drops-summary')).toHaveText('No drops left (2/2 used)')

    await authedPage
      .getByRole('button', {
        name: `Why ${rosterLeague.droppableMovieTitle} cannot be dropped`,
      })
      .click()

    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText(
      'used all 2 of your drops'
    )
    await expect(authedPage.getByTestId('drop-modal-confirm')).toHaveCount(0)
  })
})
