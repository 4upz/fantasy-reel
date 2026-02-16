import { test, expect } from '../../fixtures/league.fixture'
import { updateLeagueStatus } from '../../helpers/supabase.helper'
import { waitForPageSettle, waitForToast } from '../../helpers/ui.helper'

/**
 * Draft Order E2E Tests
 *
 * Tests the DraftOrderSection on the league settings page.
 * Covers: display, randomization, locked state, and access control.
 *
 * Fixtures used:
 * - draftReadyLeague: setup-status league with 3 participants (owner + testUser + secondUser)
 * - leagueOwnerPage: page authenticated as leagueOwner (settings requires ownership)
 * - authedPage: page authenticated as testUser (non-owner)
 */

test.describe('Draft Order', () => {
  test.describe('Setup League', () => {
    test('displays draft order section with participants', async ({
      leagueOwnerPage,
      draftReadyLeague,
    }) => {
      await leagueOwnerPage.goto(`/league/${draftReadyLeague.id}/settings`)
      await waitForPageSettle(leagueOwnerPage)

      // Verify draft order section is visible
      const section = leagueOwnerPage.locator('[data-testid="draft-order-section"]')
      await expect(section).toBeVisible({ timeout: 10000 })

      // Verify randomize button is visible
      await expect(section.locator('[data-testid="randomize-button"]')).toBeVisible()

      // Verify all 3 participants are listed
      const items = section.locator('[data-testid="draft-order-item"]')
      await expect(items).toHaveCount(3)
    })

    test('randomize button randomizes order and shows toast', async ({
      leagueOwnerPage,
      draftReadyLeague,
    }) => {
      await leagueOwnerPage.goto(`/league/${draftReadyLeague.id}/settings`)
      await waitForPageSettle(leagueOwnerPage)

      const section = leagueOwnerPage.locator('[data-testid="draft-order-section"]')
      await expect(section).toBeVisible({ timeout: 10000 })

      // Click randomize
      await section.locator('[data-testid="randomize-button"]').click()

      // Wait for success toast
      await waitForToast(leagueOwnerPage, /randomized/i)

      // Items should still be present
      const items = section.locator('[data-testid="draft-order-item"]')
      await expect(items).toHaveCount(3)
    })
  })

  test.describe('Locked State', () => {
    test('shows locked message when league not in setup', async ({
      leagueOwnerPage,
      draftReadyLeague,
    }) => {
      // Change league status to drafting
      await updateLeagueStatus(draftReadyLeague.id, 'drafting')

      await leagueOwnerPage.goto(`/league/${draftReadyLeague.id}/settings`)
      await waitForPageSettle(leagueOwnerPage)

      const section = leagueOwnerPage.locator('[data-testid="draft-order-section"]')
      await expect(section).toBeVisible({ timeout: 10000 })

      // Locked message should be visible
      await expect(section.locator('[data-testid="draft-order-locked"]')).toBeVisible()

      // Randomize and save buttons should NOT be visible
      await expect(section.locator('[data-testid="randomize-button"]')).not.toBeVisible()
      await expect(section.locator('[data-testid="save-order-button"]')).not.toBeVisible()
    })
  })

  test.describe('Access Control', () => {
    test('non-owner cannot access settings page', async ({
      authedPage,
      draftReadyLeague,
    }) => {
      // authedPage is logged in as testUser who is NOT the owner
      await authedPage.goto(`/league/${draftReadyLeague.id}/settings`)

      // Should redirect away from settings (non-owners can't access)
      await authedPage.waitForURL((url) => !url.pathname.endsWith('/settings'), {
        timeout: 10000,
      })

      // URL should still contain the league ID but not /settings
      expect(authedPage.url()).toContain(`/league/${draftReadyLeague.id}`)
      expect(authedPage.url()).not.toContain('/settings')
    })
  })
})
