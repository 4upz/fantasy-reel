import type { Locator, Page, TestInfo } from '@playwright/test'
import { test, expect } from '../../fixtures/draft.fixture'
import { getAdminClient } from '../../helpers/supabase.helper'
import {
  closeDialogWithEscape,
  expectPageStructure,
  openDialogFromKeyboard,
  scanA11y,
} from '../../helpers/a11y.helper'

/**
 * Automated screen-reader / low-vision audit: every route, in both themes, plus
 * every dialog, menu and sheet opened from the keyboard. See docs/ACCESSIBILITY.md.
 */

// Each test scans several pages in two themes; the default 60s is too short.
test.describe.configure({ timeout: 240_000 })

type Theme = 'dark' | 'light'
const THEMES: Theme[] = ['dark', 'light']

async function setTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

/** Wait until the page has replaced its loading skeletons with content. */
async function settle(page: Page) {
  await page.waitForLoadState('load')
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 20000 }).catch(() => {})
}

async function scanBothThemes(page: Page, testInfo: TestInfo, label: string) {
  for (const theme of THEMES) {
    await setTheme(page, theme)
    await scanA11y(page, testInfo, `${label} [${theme}]`)
  }
  await setTheme(page, 'dark')
}

/** Visit a route, check its page structure, and scan it in both themes. */
async function auditRoute(page: Page, testInfo: TestInfo, route: string, label = route): Promise<string> {
  await page.goto(route)
  await settle(page)
  const title = await expectPageStructure(page, label)
  await scanBothThemes(page, testInfo, label)
  return title
}

/** Open a dialog/menu/sheet from the keyboard, scan it in both themes, close it with Escape. */
async function auditDialog(page: Page, testInfo: TestInfo, trigger: Locator, label: string) {
  await expect(trigger).toBeVisible({ timeout: 15000 })
  const dialog = await openDialogFromKeyboard(page, trigger, label)
  await scanBothThemes(page, testInfo, label)
  await closeDialogWithEscape(page, dialog, trigger, label)
}

/** A disclosure (menu button + panel): Enter opens it, Escape closes it and returns focus. */
async function auditDisclosure(page: Page, testInfo: TestInfo, trigger: Locator, label: string) {
  await expect(trigger).toBeVisible({ timeout: 15000 })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect.soft(trigger, `${label}: aria-expanded reflects the open panel`).toHaveAttribute('aria-expanded', 'true')
  await scanBothThemes(page, testInfo, label)
  // From inside the panel (when it has anything to focus), Escape must close
  // it and hand focus back. An empty panel is simply left behind by Tab.
  const panelId = await trigger.getAttribute('aria-controls')
  const focusables = panelId
    ? await page.locator(`[id="${panelId}"]`).locator('a[href], button:not([disabled]), input, select, [tabindex="0"]').count()
    : 0
  if (focusables) await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await expect.soft(trigger, `${label}: Escape closes it`).toHaveAttribute('aria-expanded', 'false')
  await expect.soft(trigger, `${label}: focus returns to the trigger`).toBeFocused()
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
})

test.describe('Accessibility: public pages', () => {
  const routes = [
    '/',
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/how-to-play',
    '/privacy',
    '/terms',
    '/unsubscribe',
    '/auth/auth-code-error',
    '/error',
    '/does-not-exist',
  ]
  for (const route of routes) {
    test(`public ${route}`, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, route)
    })
  }

  test('skip link moves focus to the main content', async ({ page }) => {
    await page.goto('/login')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('main#main-content')).toBeFocused()
  })

  test('a failed sign-in is announced and keeps what was typed', async ({ page }, testInfo) => {
    await page.goto('/login')
    await page.getByTestId('email-input').fill('nobody@fantasyreel.test')
    await page.getByTestId('password-input').fill('wrong-password-1!')
    await page.getByTestId('login-button').click()
    const error = page.getByTestId('form-error')
    await expect(error).toHaveAttribute('role', 'alert', { timeout: 15000 })
    await expect(
      page.getByTestId('login-button'),
      'focus returns to Sign in; the alert reads the error once, without focus reading it again'
    ).toBeFocused()
    await expect(page.getByTestId('email-input')).toHaveValue('nobody@fantasyreel.test')
    await expect(page.getByTestId('password-input')).toHaveValue('wrong-password-1!')
    await scanBothThemes(page, testInfo, '/login with error')
  })
})

test.describe('Accessibility: account pages', () => {
  test('account pages have distinct titles and pass axe', async ({ authedPage: page }, testInfo) => {
    const titles = new Set<string>()
    for (const route of ['/dashboard', '/movies', '/wishlist', '/settings', '/help', '/join']) {
      titles.add(await auditRoute(page, testInfo, route))
    }
    expect(titles.size, 'every account page has its own title').toBe(6)
  })

  test('account dialogs and menus', async ({ authedPage: page }, testInfo) => {
    await page.goto('/dashboard')
    await settle(page)
    await auditDialog(page, testInfo, page.getByRole('button', { name: 'Create your first league', exact: true }), 'create league dialog')
    await auditDisclosure(page, testInfo, page.getByTestId('user-menu-button'), 'profile menu')
    await auditDisclosure(page, testInfo, page.getByRole('button', { name: /notifications/i }).first(), 'notifications menu')

    await page.goto('/settings')
    await settle(page)
    await auditDialog(page, testInfo, page.getByRole('button', { name: /change password/i }).first(), 'change password dialog')
    await auditDialog(page, testInfo, page.getByTestId('delete-account-button'), 'delete account dialog')
  })

  test('admin dashboard', async ({ authedPage: page, testUser }, testInfo) => {
    const admin = getAdminClient()
    await admin.from('app_admins').insert({ user_id: testUser.id })
    try {
      await auditRoute(page, testInfo, '/admin')
    } finally {
      await admin.from('app_admins').delete().eq('user_id', testUser.id)
    }
  })

  test('mobile navigation drawer', async ({ authedPage: page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await auditRoute(page, testInfo, '/dashboard', '/dashboard (mobile)')
    await auditDialog(page, testInfo, page.getByRole('button', { name: 'Open navigation menu' }), 'mobile navigation drawer')
  })
})

test.describe('Accessibility: league pages', () => {
  test('active league as a member', async ({ authedPage: page, scoredLeagueWithFullRoster: league }, testInfo) => {
    const base = `/league/${league.id}`
    const titles = new Set<string>()
    for (const tab of ['dashboard', 'standings', 'roster', 'trading', 'bidding', 'bidding/history', 'history', 'draft']) {
      titles.add(await auditRoute(page, testInfo, `${base}/${tab}`, `league/${tab}`))
    }
    expect(titles.size, 'every league tab has its own title').toBe(8)

    // The desktop detail rail lists the selected team's movies.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${base}/standings`)
    await settle(page)
    await auditDialog(page, testInfo, page.getByTestId('rail-movie-button').first(), 'standings movie dialog')
  })

  test('active league on mobile', async ({ authedPage: page, scoredLeagueWithFullRoster: league }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await auditRoute(page, testInfo, `/league/${league.id}/standings`, 'league/standings (mobile)')
    await auditRoute(page, testInfo, `/league/${league.id}/roster`, 'league/roster (mobile)')
    await auditDialog(page, testInfo, page.getByRole('button', { name: 'More', exact: true }), 'league bottom-nav sheet')
  })

  test('roster movie and drop dialogs', async ({ authedPage: page, rosterLeague: league }, testInfo) => {
    await auditRoute(page, testInfo, `/league/${league.id}/roster`, 'league/roster with drops')
    const card = page.getByTestId('roster-movie-card').filter({ hasText: league.droppableMovieTitle }).first()
    const dialog = await openDialogFromKeyboard(page, card, 'roster movie dialog')
    await scanBothThemes(page, testInfo, 'roster movie dialog')
    await page.getByTestId('drop-movie-button').click()
    await expect(page.getByTestId('league-movie-modal')).toHaveAttribute('data-view', 'confirm')
    await expect.poll(
      () => dialog.evaluate(d => d.contains(document.activeElement)),
      { message: 'drop confirm view keeps focus inside the dialog' }
    ).toBe(true)
    await scanBothThemes(page, testInfo, 'roster drop confirm dialog')
    // Escape steps back out of the confirmation before it closes the dialog.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('league-movie-modal')).toHaveAttribute('data-view', 'details')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(card, 'focus returns to the movie card').toBeFocused()
  })

  test('team settings dialog', async ({ authedPage: page, activeLeague: league }, testInfo) => {
    await page.goto(`/league/${league.id}/dashboard`)
    await settle(page)
    await auditDialog(page, testInfo, page.getByTestId('edit-team-button'), 'edit team dialog')
  })

  test('setup league as owner', async ({ leagueOwnerPage: page, draftReadyLeague: league }, testInfo) => {
    const base = `/league/${league.id}`
    for (const tab of ['dashboard', 'settings', 'draft']) {
      await auditRoute(page, testInfo, `${base}/${tab}`, `setup league/${tab}`)
    }
    await page.goto(`${base}/draft`)
    await settle(page)
    await auditDialog(page, testInfo, page.getByRole('button', { name: 'Invite players' }), 'invite dialog')

    await page.goto(`${base}/settings`)
    await settle(page)
    await auditDialog(page, testInfo, page.getByRole('button', { name: /^Remove .+ from league$/ }).first(), 'remove participant dialog')
    await auditDialog(page, testInfo, page.getByRole('button', { name: 'Delete league' }), 'delete league dialog')
  })

  test('active league as owner', async ({ leagueOwnerPage: page, activeLeague: league }, testInfo) => {
    await auditRoute(page, testInfo, `/league/${league.id}/settings`, 'active league/settings')
    await auditDialog(page, testInfo, page.getByTestId('end-season-button'), 'end season dialog')
  })

  test('live draft', async ({ leagueOwnerPage: page, readyDraft }, testInfo) => {
    await page.goto(`/league/${readyDraft.id}/draft`)
    await page.getByTestId('start-draft-button').click()
    await expect(page.getByTestId('draft-board')).toBeVisible()
    await settle(page)
    await scanBothThemes(page, testInfo, 'live draft')
    await page.getByTestId('movie-search-input').fill(readyDraft.query)
    const first = page.getByTestId(`preview-movie-${readyDraft.movies[0].tmdb_id}`)
    await expect(first).toBeVisible()
    await scanBothThemes(page, testInfo, 'live draft search results')
    await auditDialog(page, testInfo, first, 'draft movie preview dialog')
  })

  test('trading with an offer', async ({ authedPage: page, tradingLeagueWithTrade: league }, testInfo) => {
    await auditRoute(page, testInfo, `/league/${league.id}/trading`, 'league/trading with offer')
    await auditDialog(page, testInfo, page.getByTestId(`accept-trade-${league.tradeOfferId}`), 'accept trade dialog')
    await auditDialog(page, testInfo, page.getByTestId('propose-trade-button'), 'propose trade dialog')
  })

  test('bidding', async ({ authedPage: page, biddingLeague: league }, testInfo) => {
    await auditRoute(page, testInfo, `/league/${league.id}/bidding`, 'league/bidding')
    await auditDialog(page, testInfo, page.getByTestId('place-bid-button'), 'place bid dialog')
  })

  test('bidding with a bid', async ({ authedPage: page, biddingLeagueWithBid: league }, testInfo) => {
    await auditRoute(page, testInfo, `/league/${league.id}/bidding`, 'league/bidding with bid')
    await auditDialog(page, testInfo, page.getByTestId(`cancel-bid-${league.bidTmdbId}`), 'cancel bid dialog')
  })
})

/**
 * Projected scores (Beta) are off in E2E: `projections_display` is disabled and
 * nothing has been computed. Mock `get-movie-projections` on so the chips, the
 * projected standings and their dialogs are scanned like everything else.
 */
async function mockProjectionsOn(page: Page) {
  await page.route('**/functions/v1/get-movie-projections**', async (route) => {
    const body = route.request().postDataJSON() as { tmdb_ids?: number[] } | null
    const ids = body?.tmdb_ids ?? []
    const projections = Object.fromEntries(
      ids.map((tmdbId, index) => {
        // Alternate a confident fresh range with a wide, rotten-leaning guess,
        // so both the range and the "Low confidence" readings are on screen.
        const wide = index % 2 === 1
        const projected = wide ? 52 : 74
        return [
          String(tmdbId),
          {
            tmdb_id: tmdbId,
            projected_rt: projected,
            range50: wide ? [38, 66] : [70, 78],
            range80: wide ? [25, 78] : [62, 84],
            low_confidence: wide,
            insufficient_history: false,
            p_rotten: wide ? 0.6 : 0.15,
            p_fresh: wide ? 0.4 : 0.85,
            p_90: wide ? 0.02 : 0.06,
            expected_points: projected - 60,
            baseline_rt: 61,
            contributions: [
              { factor: 'director', label: 'Director', delta_rt: wide ? -6 : 8 },
              { factor: 'cast', label: 'Cast', delta_rt: wide ? -3 : 5 },
            ],
            coverage: 0.8,
            partial: false,
            includes_early_reviews: false,
            early_rt: null,
            computed_at: new Date().toISOString(),
          },
        ]
      })
    )
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: true, model_version: 1, projections }),
    })
  })
}

test.describe('Accessibility: projected scores (Beta)', () => {
  test('roster, projected standings and their dialogs', async ({ authedPage: page, rosterLeague: league }, testInfo) => {
    await mockProjectionsOn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    const base = `/league/${league.id}`

    await page.goto(`${base}/roster`)
    await settle(page)
    await expect(page.getByTestId('projection-chip').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('how-it-adds-up')).toBeVisible({ timeout: 20000 })
    await scanBothThemes(page, testInfo, 'league/roster with projections')
    await auditDialog(page, testInfo, page.getByTestId('how-it-adds-up'), 'roster team projection sheet')

    await page.goto(`${base}/standings`)
    await settle(page)
    const projectedToggle = page.getByTestId('standings-view-projected')
    await expect(projectedToggle).toBeVisible({ timeout: 20000 })
    await expect(projectedToggle).toHaveAttribute('aria-pressed', 'false')
    await projectedToggle.focus()
    await page.keyboard.press('Enter')
    await expect(projectedToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('projected-standings')).toBeVisible()
    await expect.soft(projectedToggle, 'the toggle keeps focus through the view swap').toBeFocused()
    await scanBothThemes(page, testInfo, 'league/standings projected view')

    // The team sheet, then the chip's breakdown popover inside it.
    const row = page.getByTestId(`projected-row-${league.testUserTeamId}`)
    const sheet = await openDialogFromKeyboard(page, row, 'projected standings team sheet')
    await scanBothThemes(page, testInfo, 'projected standings team sheet')
    await auditDisclosure(page, testInfo, sheet.getByTestId('projection-chip').first(), 'projection breakdown popover')
    await closeDialogWithEscape(page, sheet, row, 'projected standings team sheet')

    // On a phone the breakdown is a bottom sheet: a modal dialog of its own.
    await page.setViewportSize({ width: 390, height: 844 })
    const phoneSheet = await openDialogFromKeyboard(page, row, 'projected team sheet (mobile)')
    await auditDialog(page, testInfo, phoneSheet.getByTestId('projection-chip').first(), 'projection breakdown sheet (mobile)')
    await closeDialogWithEscape(page, phoneSheet, row, 'projected team sheet (mobile)')
  })
})
