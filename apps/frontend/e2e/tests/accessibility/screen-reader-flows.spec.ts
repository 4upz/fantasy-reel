import type { Page } from '@playwright/test'
import { test, expect, openDraft, startDraft, searchDraft, pickMovie } from '../../fixtures/draft.fixture'

/**
 * What a screen-reader user hears during realtime play, read from the live
 * regions `announce()` (utils/announce.ts) writes to. A sighted user sees the
 * board change; these assert the same news is spoken.
 */

const politeRegion = (page: Page) => page.locator('[data-live-announcer="polite"]')
const assertiveRegion = (page: Page) => page.locator('[data-live-announcer="assertive"]')

test.describe('Modal dialogs', () => {
  test('a dialog stays open through repeated Escape while its request is in flight', async ({ authedPage: page }) => {
    await page.goto('/settings')
    const trigger = page.getByRole('button', { name: /change password/i }).first()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await expect(dialog).toBeVisible()

    // Hold the server action open so the dialog is busy (preventClose).
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/settings', async route => {
      if (route.request().method() === 'POST') await held
      await route.continue()
    })
    await dialog.getByLabel('Current password', { exact: true }).fill('testpass123!')
    await dialog.getByLabel('New password', { exact: true }).fill('a-new-password-1!')
    await dialog.getByLabel('Confirm new password', { exact: true }).fill('a-new-password-1!')
    await dialog.getByRole('button', { name: /change password|update password|save/i }).last().click()

    // Browsers stop honouring a cancelled Escape after the first one; the
    // dialog must still not close, or React loses track of it.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    release()
    // The request settles (a wrong current password just shows an error) and
    // Escape works again once nothing is in flight.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled({ timeout: 15000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

test.describe('Screen-reader announcements: live draft', () => {
  test('the next player hears the pick and that it is their turn; the picker hears their own pick once', async ({
    leagueOwnerPage: owner, authedPage: nextPlayer, readyDraft,
  }) => {
    const [first] = readyDraft.movies
    await startDraft(owner, readyDraft)
    await openDraft(nextPlayer, readyDraft)
    await expect(nextPlayer.getByTestId('draft-connection-status')).toHaveText('Live')

    // Loading the board is not news.
    await expect(assertiveRegion(nextPlayer)).toHaveCount(0)

    await searchDraft(owner, readyDraft)
    await pickMovie(owner, first)

    // The observer learns who picked what and, urgently, that it is now their turn.
    await expect(assertiveRegion(nextPlayer)).toContainText(`drafted ${first.title}`, { timeout: 10000 })
    await expect(assertiveRegion(nextPlayer)).toContainText("It's your turn to draft")

    // The picker hears their own pick confirmed, once, and not as someone else's.
    await expect(politeRegion(owner)).toContainText(`You drafted ${first.title}`)
    await expect(politeRegion(owner)).not.toContainText(`Owner Team drafted ${first.title}`)
  })
})
