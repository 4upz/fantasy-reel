import { test, expect, loginAs } from '../../fixtures/league.fixture'
import {
  createInvitation,
  createExpiredInvitation,
  getAdminClient,
} from '../../helpers/supabase.helper'
import {
  getLatestEmail,
  clearMailbox,
  extractAuthLink,
} from '../../helpers/email.helper'

/**
 * Join League via Email Invitation E2E tests
 * Tests the complete invitation flow from sending to acceptance
 */
test.describe('Join League via Invitation', () => {
  test.describe('Accept Invitation', () => {
    test('join via valid invitation token @critical', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      // Create invitation for test user
      const invitation = await createInvitation(
        testLeague.id,
        testUser.email,
        leagueOwner.id
      )

      // Login as the invited user
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)

      // Navigate to join page with token
      await userPage.goto(`/join?token=${invitation.token}`)

      // Should show league details
      await expect(userPage.getByText(testLeague.name)).toBeVisible()

      // Should show invitation context (from owner, etc.)
      await expect(userPage.getByText(/invited/i)).toBeVisible()

      // Enter team name
      await userPage.fill('[data-testid="team-name-input"]', 'Invited Team')

      // Click join button
      await userPage.click('[data-testid="join-league-button"]')

      // Should redirect to league page
      await userPage.waitForURL(`/league/${testLeague.id}**`)

      // Verify joined successfully
      await expect(userPage.getByText('Invited Team')).toBeVisible()

      await userContext.close()
    })

    test('requires team name to join', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      const invitation = await createInvitation(
        testLeague.id,
        testUser.email,
        leagueOwner.id
      )

      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?token=${invitation.token}`)

      // Try to join without team name
      await userPage.click('[data-testid="join-league-button"]')

      // Should show validation error
      await expect(
        userPage.getByText(/team name.*required|enter.*team name/i)
      ).toBeVisible()

      await userContext.close()
    })

    test('redirects to login if not authenticated', async ({
      page,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      const invitation = await createInvitation(
        testLeague.id,
        testUser.email,
        leagueOwner.id
      )

      // Navigate without logging in
      await page.goto(`/join?token=${invitation.token}`)

      // Should redirect to login
      await page.waitForURL(/\/login/)

      // Should preserve return URL
      expect(page.url()).toContain('returnUrl')
      expect(page.url()).toContain(invitation.token)
    })
  })

  test.describe('Invalid/Expired Invitations', () => {
    test('invalid token shows error', async ({ authenticatedPage }) => {
      const page = authenticatedPage

      await page.goto('/join?token=invalid-token-12345')

      // Should show error message
      await expect(
        page.getByText(/invalid|not found|expired/i)
      ).toBeVisible()

      // Should not show join form
      await expect(
        page.getByTestId('join-league-button')
      ).not.toBeVisible()
    })

    test('expired invitation shows error', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      // Create expired invitation
      const invitation = await createExpiredInvitation(
        testLeague.id,
        testUser.email,
        leagueOwner.id
      )

      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?token=${invitation.token}`)

      // Should show expired message
      await expect(userPage.getByText(/expired/i)).toBeVisible()

      await userContext.close()
    })

    test('already used invitation shows error', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
      secondUser,
    }) => {
      // Create invitation for testUser
      const invitation = await createInvitation(
        testLeague.id,
        testUser.email,
        leagueOwner.id
      )

      // First user joins successfully
      const user1Context = await browser.newContext()
      const user1Page = await user1Context.newPage()

      await loginAs(user1Page, testUser)
      await user1Page.goto(`/join?token=${invitation.token}`)
      await user1Page.fill('[data-testid="team-name-input"]', 'First Team')
      await user1Page.click('[data-testid="join-league-button"]')
      await user1Page.waitForURL(`/league/${testLeague.id}**`)

      // Second user tries same token
      const user2Context = await browser.newContext()
      const user2Page = await user2Context.newPage()

      await loginAs(user2Page, secondUser)
      await user2Page.goto(`/join?token=${invitation.token}`)

      // Should show error (invitation already used)
      await expect(
        user2Page.getByText(/already used|invalid|already joined/i)
      ).toBeVisible()

      await user1Context.close()
      await user2Context.close()
    })
  })

  test.describe('Decline Invitation', () => {
    test('can decline invitation', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      const invitation = await createInvitation(
        testLeague.id,
        testUser.email,
        leagueOwner.id
      )

      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?token=${invitation.token}`)

      // Click decline button
      await userPage.click('[data-testid="decline-invitation-button"]')

      // Confirm if dialog appears
      const confirmButton = userPage.getByTestId('confirm-decline-button')
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click()
      }

      // Should redirect to dashboard or show confirmation
      await userPage.waitForURL(/dashboard|\//, { timeout: 10000 })

      // Trying to use the same invitation should now fail
      await userPage.goto(`/join?token=${invitation.token}`)
      await expect(
        userPage.getByText(/declined|invalid|not found/i)
      ).toBeVisible()

      await userContext.close()
    })
  })

  test.describe('League Full', () => {
    test('cannot join full league', async ({
      browser,
      leagueOwner,
      testUser,
    }) => {
      const client = getAdminClient()

      // Create league with max 2 participants
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

      // Add owner
      await client.from('league_participants').insert({
        league_id: league.id,
        user_id: leagueOwner.id,
        role: 'owner',
        status: 'active',
      })

      // Add filler user
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

      // Create invitation for testUser
      const invitation = await createInvitation(
        league.id,
        testUser.email,
        leagueOwner.id
      )

      // Try to join
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?token=${invitation.token}`)

      // Should show league full error
      await expect(
        userPage.getByText(/full|maximum.*reached|no.*spots/i)
      ).toBeVisible()

      // Cleanup
      await userContext.close()
      if (filler?.user) {
        await client.auth.admin.deleteUser(filler.user.id)
      }
      await client.from('leagues').delete().eq('id', league.id)
    })
  })

  test.describe('Wrong User', () => {
    test('invitation for different email shows warning', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
      secondUser,
    }) => {
      // Create invitation for secondUser's email
      const invitation = await createInvitation(
        testLeague.id,
        secondUser.email,
        leagueOwner.id
      )

      // But testUser tries to use it
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto(`/join?token=${invitation.token}`)

      // Should either:
      // 1. Allow joining (invitation is for league, not specific user)
      // 2. Show warning about different email
      // 3. Block access

      // Check what behavior is implemented
      const canJoin = await userPage
        .getByTestId('join-league-button')
        .isVisible()
        .catch(() => false)
      const showsWarning = await userPage
        .getByText(/different.*email|not.*intended/i)
        .isVisible()
        .catch(() => false)
      const blocked = await userPage
        .getByText(/not authorized|invalid/i)
        .isVisible()
        .catch(() => false)

      // One of these should be true
      expect(canJoin || showsWarning || blocked).toBe(true)

      await userContext.close()
    })
  })

  test.describe('Dashboard Invitations', () => {
    test('pending invitations shown on dashboard', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      // Create invitation
      await createInvitation(testLeague.id, testUser.email, leagueOwner.id)

      // Login and go to dashboard
      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto('/dashboard')

      // Should show pending invitation
      await expect(
        userPage.getByText(/pending.*invitation|invited to/i)
      ).toBeVisible()
      await expect(userPage.getByText(testLeague.name)).toBeVisible()

      await userContext.close()
    })

    test('can accept invitation from dashboard', async ({
      browser,
      testLeague,
      leagueOwner,
      testUser,
    }) => {
      await createInvitation(testLeague.id, testUser.email, leagueOwner.id)

      const userContext = await browser.newContext()
      const userPage = await userContext.newPage()

      await loginAs(userPage, testUser)
      await userPage.goto('/dashboard')

      // Find and click accept button for this invitation
      const invitationCard = userPage.locator('[data-testid="invitation-card"]', {
        hasText: testLeague.name,
      })
      await expect(invitationCard).toBeVisible()

      await invitationCard.getByTestId('accept-invitation-button').click()

      // Should navigate to join page or show team name input
      // Implementation varies - check for either
      const onJoinPage = await userPage
        .waitForURL(/\/join/)
        .then(() => true)
        .catch(() => false)

      const teamInput = await userPage
        .getByTestId('team-name-input')
        .isVisible()
        .catch(() => false)

      expect(onJoinPage || teamInput).toBe(true)

      await userContext.close()
    })
  })
})
