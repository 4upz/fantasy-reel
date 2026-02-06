import { test, expect, loginAs } from '../../fixtures/league.fixture'
import {
  generateJoinLink,
  clearJoinCode,
  updateLeagueStatus,
  getAdminClient,
} from '../../helpers/supabase.helper'
import { waitForPageSettle } from '../../helpers/ui.helper'

/**
 * Shareable Join Link E2E tests
 * Tests the new feature allowing users to join leagues via shareable codes
 */
test.describe('Shareable Join Links', () => {
  test.describe('Join via Code', () => {
    test('user can join league via join code @critical', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      // Generate join link for the league
      const { joinCode } = await generateJoinLink(testLeague.id)

      // Create new context for the joining user
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)

      // Navigate to join page with code
      await userPage.goto(`/join?code=${joinCode}`)
      await userPage.waitForLoadState('networkidle')

      // Should show league details
      await expect(userPage.getByText(testLeague.name)).toBeVisible()

      // Enter team name
      await userPage.fill('[data-testid="team-name-input"]', 'My New Team')

      // Submit join request
      await userPage.click('[data-testid="join-league-button"]')

      // Wait for network request to complete
      await userPage.waitForLoadState('networkidle')

      // Should redirect to league page
      await userPage.waitForURL(`/league/${testLeague.id}**`, { timeout: 10000 })

      // Verify user is now a participant
      await expect(userPage.getByText('My New Team')).toBeVisible()

      await userContext.close()
    })

    test('invalid join code shows error', async ({ authenticatedPage }) => {
      const page = authenticatedPage

      // Navigate with invalid code
      await page.goto('/join?code=INVALIDCODE123')
      await page.waitForLoadState('networkidle')

      // Should show error message
      await expect(
        page.getByText(/invalid.*code|league not found|expired/i)
      ).toBeVisible()
    })

    test('cannot join full league via code', async ({
      browser,
      leagueOwner,
      testUser,
    }) => {
      // Create a league with max 2 participants (owner + 1)
      const client = getAdminClient()
      const { data: league } = await client
        .from('leagues')
        .insert({
          name: `Full League ${Date.now()}`,
          owner_id: leagueOwner.id,
          status: 'setup',
          max_participants: 2,
        })
        .select()
        .single()

      if (!league) throw new Error('Failed to create league')

      // Add owner as participant
      await client.from('league_participants').insert({
        league_id: league.id,
        user_id: leagueOwner.id,
        role: 'owner',
        status: 'active',
      })

      // Add another user to fill the league
      const { data: filler } = await client.auth.admin.createUser({
        email: `filler-${Date.now()}@test.local`,
        password: 'Test123!',
        email_confirm: true,
      })

      if (filler?.user) {
        await client.from('league_participants').insert({
          league_id: league.id,
          user_id: filler.user.id,
          role: 'member',
          status: 'active',
        })
      }

      // Generate join code
      const { joinCode } = await generateJoinLink(league.id)

      // Try to join as testUser
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?code=${joinCode}`)
      await userPage.waitForLoadState('networkidle')

      // Should show league full error
      await expect(userPage.getByText(/full|maximum.*reached/i)).toBeVisible()

      // Cleanup
      await userContext.close()
      if (filler?.user) {
        await client.auth.admin.deleteUser(filler.user.id)
      }
      await client.from('leagues').delete().eq('id', league.id)
    })

    test('cannot join league after draft starts', async ({
      browser,
      testLeague,
      testUser,
    }) => {
      // Generate join code first
      const { joinCode } = await generateJoinLink(testLeague.id)

      // Start the draft
      await updateLeagueStatus(testLeague.id, 'drafting')

      // Try to join
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?code=${joinCode}`)
      await userPage.waitForLoadState('networkidle')

      // Should show error about draft already started
      await expect(
        userPage.getByText(/draft.*started|no longer accepting|closed/i)
      ).toBeVisible()

      await userContext.close()
    })
  })

  test.describe('Generate Join Link (Owner)', () => {
    test('owner can generate join link from settings @critical', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Navigate to league settings
      await page.goto(`/league/${testLeague.id}/settings`)
      await page.waitForLoadState('networkidle')

      // Find join link section
      await expect(page.getByText(/shareable.*link|join.*link/i)).toBeVisible()

      // Click generate button
      await page.click('[data-testid="generate-join-link-button"]')

      // Wait for network request to complete
      await page.waitForLoadState('networkidle')

      // Should show the generated code
      await expect(page.getByTestId('join-code-display')).toBeVisible()

      // Code should be 12 characters alphanumeric
      const codeElement = page.getByTestId('join-code-display')
      const code = await codeElement.textContent()
      expect(code).toMatch(/^[A-Z0-9]{12}$/)

      // Should also show full URL
      await expect(page.getByTestId('join-link-url')).toBeVisible()
    })

    test('copy join link to clipboard', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Generate link first
      await generateJoinLink(testLeague.id)

      await page.goto(`/league/${testLeague.id}/settings`)
      await page.waitForLoadState('networkidle')

      // Find and click copy button
      await page.click('[data-testid="copy-join-link-button"]')

      // Should show success feedback
      await expect(page.getByText(/copied/i)).toBeVisible()
    })

    test('regenerate join link invalidates old code', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      const page = await browser.newPage()
      await loginAs(page, leagueOwner)

      // Generate initial join code
      const { joinCode: oldCode } = await generateJoinLink(testLeague.id)

      await page.goto(`/league/${testLeague.id}/settings`)
      await page.waitForLoadState('networkidle')

      // Click regenerate
      await page.click('[data-testid="regenerate-join-link-button"]')

      // Confirm regeneration if dialog appears
      const confirmButton = page.getByTestId('confirm-regenerate-button')
      const confirmVisible = await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)
      if (confirmVisible) {
        await confirmButton.click()
      }

      // Wait for network request to complete
      await page.waitForLoadState('networkidle')
      await waitForPageSettle(page)

      // Get new code
      const newCodeElement = page.getByTestId('join-code-display')
      const newCode = await newCodeElement.textContent()

      // Codes should be different
      expect(newCode).not.toBe(oldCode)

      // Old code should no longer work
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?code=${oldCode}`)
      await userPage.waitForLoadState('networkidle')

      // Should show error
      await expect(
        userPage.getByText(/invalid|not found|expired/i)
      ).toBeVisible()

      await page.close()
      await userContext.close()
    })

    test('join link section disabled after draft starts', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Generate link first
      await generateJoinLink(testLeague.id)

      // Start draft
      await updateLeagueStatus(testLeague.id, 'drafting')

      await page.goto(`/league/${testLeague.id}/settings`)
      await page.waitForLoadState('networkidle')

      // Generate button should be disabled or section should indicate unavailable
      const generateButton = page.getByTestId('generate-join-link-button')
      const buttonVisible = await generateButton.isVisible({ timeout: 2000 }).catch(() => false)

      if (buttonVisible) {
        await expect(generateButton).toBeDisabled()
      } else {
        // Or section shows unavailable message
        await expect(
          page.getByText(/unavailable|disabled|draft.*started/i)
        ).toBeVisible()
      }
    })

    test('non-owner cannot access settings to generate link', async ({
      browser,
      testLeague,
      testUser,
    }) => {
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)

      // Try to access settings directly
      await userPage.goto(`/league/${testLeague.id}/settings`)
      await userPage.waitForLoadState('networkidle')

      // Should be redirected or show access denied
      // Either redirected away from settings or see error message
      const url = userPage.url()
      const hasAccess = url.includes('/settings')

      if (hasAccess) {
        // If somehow on settings page, should not see join link section
        // or see it disabled
        await expect(
          userPage.getByTestId('generate-join-link-button')
        ).not.toBeVisible()
      }

      await userContext.close()
    })
  })

  test.describe('Join Link Display', () => {
    test('existing join link shown on settings page', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Generate link via helper
      const { joinCode } = await generateJoinLink(testLeague.id)

      await page.goto(`/league/${testLeague.id}/settings`)
      await page.waitForLoadState('networkidle')

      // Should display existing code
      await expect(page.getByTestId('join-code-display')).toContainText(
        joinCode
      )
    })

    test('no link shows generate prompt', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Ensure no join code
      await clearJoinCode(testLeague.id)

      await page.goto(`/league/${testLeague.id}/settings`)
      await page.waitForLoadState('networkidle')

      // Should show generate button/prompt, not a code
      await expect(page.getByTestId('generate-join-link-button')).toBeVisible()

      // Code display should not be visible or should be empty
      const codeDisplay = page.getByTestId('join-code-display')
      const codeVisible = await codeDisplay.isVisible({ timeout: 1000 }).catch(() => false)
      if (codeVisible) {
        const text = await codeDisplay.textContent()
        expect(text?.trim()).toBeFalsy()
      }
    })
  })

  test.describe('Join Link in Draft Page', () => {
    test('join link card shown on draft page before draft starts', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Generate join link
      const { joinCode } = await generateJoinLink(testLeague.id)

      await page.goto(`/league/${testLeague.id}/draft`)
      await page.waitForLoadState('networkidle')

      // JoinLinkCard should be visible
      await expect(page.getByTestId('join-link-card')).toBeVisible()

      // Should show the code
      await expect(page.getByTestId('join-link-card')).toContainText(joinCode)
    })

    test('join link card hidden after draft starts', async ({
      authenticatedPage,
      testLeague,
      leagueOwner,
    }) => {
      const page = authenticatedPage
      await loginAs(page, leagueOwner)

      // Generate link and start draft
      await generateJoinLink(testLeague.id)
      await updateLeagueStatus(testLeague.id, 'drafting')

      await page.goto(`/league/${testLeague.id}/draft`)
      await page.waitForLoadState('networkidle')

      // JoinLinkCard should not be visible
      await expect(page.getByTestId('join-link-card')).not.toBeVisible()
    })
  })
})
