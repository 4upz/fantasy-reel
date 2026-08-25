import { test, expect } from '../../fixtures/league.fixture'
import { waitForToast } from '../../helpers/ui.helper'
import { getAdminClient } from '../../helpers/supabase.helper'

/**
 * Roster Movie Dialog / Drop Flow E2E Tests
 *
 * The roster card is the control: tapping a movie opens its TMDb details, and
 * the roster's actions live in that dialog. Dropping is a second view inside
 * the same dialog, so there is never a modal stacked on a modal.
 *
 * Regressions these guard against:
 *
 * 1. The drop control used to be `opacity-0 group-hover:opacity-100`, so on a
 *    touch device - which never hovers - it was fully transparent while still
 *    occupying a tappable corner of the poster. Teams could not find it and sat
 *    on movies they meant to drop, which took a manual database repair to
 *    unwind. Note `toBeVisible()` alone does NOT catch that: Playwright treats
 *    an `opacity: 0` element as visible because it still has a bounding box, so
 *    the reachability test asserts computed opacity directly.
 *
 * 2. A movie that could not be dropped gave no sign of it, so it looked
 *    identical to one the player had simply never tried to drop. Locked movies
 *    now carry a badge on the card, and the dialog says why.
 *
 * Uses the rosterLeague fixture, whose testUser roster holds one movie in each
 * state: unreleased, released-and-scored, and counterpicked. Only the
 * counterpicked one is locked -- a released movie is droppable, it just costs
 * the points it has already banked.
 *
 * Key UI elements:
 * - roster-movie-card: the whole card, opens the dialog (data-locked marks locked)
 * - roster-lock-badge: the at-a-glance "you cannot drop this" marker
 * - league-movie-modal: the one dialog (data-view is "details" or "confirm")
 * - drop-movie-button: the Drop action inside the details view
 * - drop-blocker-headline: the reason a locked movie cannot be dropped
 */

/** Minimum comfortable touch target, per the WCAG 2.5.5 / Apple HIG guidance. */
const MIN_TAP_TARGET_PX = 44

const MOBILE_VIEWPORT = { width: 390, height: 844 }

/** Every movie the rosterLeague fixture puts on the testUser roster. */
const HELD_MOVIE_COUNT = 3

/** Opens a movie's dialog by card label. */
async function openMovie(page: import('@playwright/test').Page, title: string, locked = false) {
  await page.getByRole('button', { name: `View ${title}${locked ? ' (locked)' : ''}` }).click()
  await expect(page.getByTestId('league-movie-modal')).toBeVisible()
}

test.describe('Roster Drop Flow @roster', () => {
  test('every held movie is an openable card on a touch viewport', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    const cards = authedPage.getByTestId('roster-movie-card')
    await expect(cards).toHaveCount(HELD_MOVIE_COUNT)

    // The regression guard. No hover has happened, so a hover-gated control
    // would report opacity "0" here while still passing toBeVisible().
    for (let i = 0; i < HELD_MOVIE_COUNT; i++) {
      const presentation = await cards.nth(i).evaluate((el) => {
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

    // Locked movies are distinguishable without opening anything. Only the
    // counterpicked movie qualifies: a released movie can still be dropped.
    await expect(authedPage.getByTestId('roster-lock-badge')).toHaveCount(1)
  })

  test('the dialog shows movie details with the roster action attached', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await openMovie(authedPage, rosterLeague.droppableMovieTitle)

    const modal = authedPage.getByTestId('league-movie-modal')
    await expect(modal).toHaveAttribute('data-view', 'details')
    await expect(
      modal.getByRole('heading', { name: new RegExp(rosterLeague.droppableMovieTitle) })
    ).toBeVisible()
    await expect(modal.getByText('On your roster')).toBeVisible()
    await expect(authedPage.getByTestId('drop-movie-button')).toBeVisible()
  })

  test('the confirm view spells out the cost, and the drop is recorded', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await expect(authedPage.getByTestId('drops-summary')).toHaveText('Drops: 0/2 used')

    await openMovie(authedPage, rosterLeague.droppableMovieTitle)
    await authedPage.getByTestId('drop-movie-button').click()

    // Same dialog, second view - not a modal stacked on a modal.
    const modal = authedPage.getByTestId('league-movie-modal')
    await expect(modal).toHaveAttribute('data-view', 'confirm')
    await expect(authedPage.getByTestId('league-movie-modal')).toHaveCount(1)

    await expect(
      modal.getByRole('heading', { name: `Drop ${rosterLeague.droppableMovieTitle}?` })
    ).toBeVisible()
    await expect(authedPage.getByTestId('drops-after-line')).toContainText('1 left')
    await expect(modal.getByText(/cannot be undone/i)).toBeVisible()
    await expect(modal.getByText(/any team can bid on it/i)).toBeVisible()

    await authedPage.getByTestId('drop-modal-confirm').click()

    await waitForToast(authedPage, new RegExp(`Dropped ${rosterLeague.droppableMovieTitle}`))

    // The dialog closes, the card goes away, the allowance ticks up.
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

  test('keeping the movie returns to details without dropping', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await openMovie(authedPage, rosterLeague.droppableMovieTitle)
    await authedPage.getByTestId('drop-movie-button').click()

    const modal = authedPage.getByTestId('league-movie-modal')
    await expect(modal).toHaveAttribute('data-view', 'confirm')

    // Backing out lands on the details, not on a closed dialog - a mis-tap
    // should not lose the movie you were reading about.
    await authedPage.getByTestId('drop-modal-dismiss').click()
    await expect(modal).toHaveAttribute('data-view', 'details')

    await authedPage.getByTestId('league-modal-close').click()
    await expect(modal).toHaveCount(0)
    await expect(authedPage.getByTestId('drops-summary')).toHaveText('Drops: 0/2 used')

    const client = getAdminClient()
    const { data: drops } = await client
      .from('team_drops')
      .select('id')
      .eq('team_id', rosterLeague.testUserTeamId)
    expect(drops).toHaveLength(0)
  })

  test('a counterpicked movie names the team that locked it and offers no drop', async ({
    authedPage,
    rosterLeague,
  }) => {
    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    await openMovie(authedPage, rosterLeague.counterpickedMovieTitle, true)

    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText('Owner Team')
    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText(
      rosterLeague.counterpickedMovieTitle
    )
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveCount(0)
  })

  test('a released movie can be dropped, and its points go with it', async ({
    authedPage,
    rosterLeague,
  }) => {
    const client = getAdminClient()

    // Bring the stored total in line with the fixture's scored movie, the way
    // update-scores would, so the drop has something to take away.
    await client.rpc('recalculate_team_score_with_counterpicks', {
      p_team_id: rosterLeague.testUserTeamId,
    })
    const { data: before } = await client
      .from('team_scores')
      .select('total_points')
      .eq('team_id', rosterLeague.testUserTeamId)
      .single()
    expect(Number(before?.total_points)).toBe(-17.5)

    await authedPage.setViewportSize(MOBILE_VIEWPORT)
    await authedPage.goto(`/league/${rosterLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toBeVisible({ timeout: 10000 })

    // Not locked, and the drop is offered.
    await openMovie(authedPage, rosterLeague.releasedMovieTitle)
    await expect(authedPage.getByTestId('drop-blocker-headline')).toHaveCount(0)
    await authedPage.getByTestId('drop-movie-button').click()

    // The confirmation tells the truth about a released movie: the points are
    // real and immediate, and nobody can bid it back.
    const modal = authedPage.getByTestId('league-movie-modal')
    await expect(modal).toHaveAttribute('data-view', 'confirm')
    await expect(modal.getByText(/standings update the moment you confirm/i)).toBeVisible()
    await expect(modal.getByText(/out of the league for good/i)).toBeVisible()
    await expect(modal.getByText(/any team can bid on it/i)).toHaveCount(0)

    await authedPage.getByTestId('drop-modal-confirm').click()
    await waitForToast(authedPage, new RegExp(`Dropped ${rosterLeague.releasedMovieTitle}`))

    const { data: pick } = await client
      .from('draft_picks')
      .select('dropped_at')
      .eq('id', rosterLeague.releasedDraftPickId)
      .single()
    expect(pick?.dropped_at).not.toBeNull()

    // The trigger from 20260825120000_rescore_team_on_drop.sql: the flop's
    // penalty is off the books.
    const { data: after } = await client
      .from('team_scores')
      .select('total_points')
      .eq('team_id', rosterLeague.testUserTeamId)
      .single()
    expect(Number(after?.total_points)).toBe(0)

    // A released movie cannot be bid back, so the league is not told it is up
    // for grabs.
    const { data: notifications } = await client
      .from('notifications')
      .select('id')
      .eq('league_id', rosterLeague.id)
      .eq('type', 'pickup_available')
    expect(notifications ?? []).toHaveLength(0)
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
    // With no drops left every held movie is locked, badge included.
    await expect(authedPage.getByTestId('roster-lock-badge')).toHaveCount(HELD_MOVIE_COUNT)

    await openMovie(authedPage, rosterLeague.droppableMovieTitle, true)

    await expect(authedPage.getByTestId('drop-blocker-headline')).toContainText(
      'used all 2 of your drops'
    )
    await expect(authedPage.getByTestId('drop-movie-button')).toHaveCount(0)
  })
})
