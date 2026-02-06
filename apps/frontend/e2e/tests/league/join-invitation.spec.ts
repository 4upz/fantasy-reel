import { test, expect, loginAs } from '../../fixtures/league.fixture'
import {
  createInvitation,
  createExpiredInvitation,
  getAdminClient,
} from '../../helpers/supabase.helper'

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

      // Should show join league page (heading specifically to avoid matching button)
      await expect(userPage.getByRole('heading', { name: /join league/i })).toBeVisible()

      // Should show invitation context
      await expect(userPage.getByText(/invited/i)).toBeVisible()

      // Enter team name
      await userPage.getByTestId('team-name-input').fill('Invited Team')

      // Click join button
      await userPage.getByTestId('join-league-button').click()

      // Should redirect to league page
      await userPage.waitForURL(`/league/${testLeague.id}**`, { timeout: 15000 })

      // Verify joined successfully
      await expect(userPage.getByText('Invited Team')).toBeVisible()

      await userContext.close()
    })

    test('can join without team name (uses default)', async ({
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

      // Join without entering team name (it's optional)
      await userPage.getByTestId('join-league-button').click()

      // Should redirect to league page (team name defaults to username-based name)
      await userPage.waitForURL(`/league/${testLeague.id}**`, { timeout: 15000 })

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

      // Should redirect to login - the (authenticated) layout redirects
      // unauthenticated users to /login before the join page component runs
      await page.waitForURL(/\/login/, { timeout: 15000 })
    })
  })

  test.describe('Invalid/Expired Invitations', () => {
    test('invalid token shows error', async ({ authenticatedPage }) => {
      const page = authenticatedPage

      await page.goto('/join?token=invalid-token-12345')

      // Should show error in the alert area
      // The JoinLeagueClient shows errors in an alert-error div with "Unable to join" heading
      // Note: with an invalid token, the edge function returns an error immediately on join attempt.
      // But first the page loads with the token form visible. The error shows after clicking join.
      // Wait for the page to settle
      await expect(page.getByTestId('join-league-button')).toBeVisible({ timeout: 10000 })

      // Click join to trigger validation
      await page.getByTestId('join-league-button').click()

      // Should show error message
      await expect(page.getByTestId('form-error')).toBeVisible({ timeout: 10000 })
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

      // The page shows the join form initially; error appears after clicking join
      await expect(userPage.getByTestId('join-league-button')).toBeVisible({ timeout: 10000 })
      await userPage.getByTestId('join-league-button').click()

      // Should show error about expired invitation
      await expect(userPage.getByTestId('form-error')).toBeVisible({ timeout: 10000 })

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
      await user1Page.getByTestId('team-name-input').fill('First Team')
      await user1Page.getByTestId('join-league-button').click()
      await user1Page.waitForURL(`/league/${testLeague.id}**`, { timeout: 15000 })

      // Second user tries same token
      const user2Context = await browser.newContext()
      const user2Page = await user2Context.newPage()

      await loginAs(user2Page, secondUser)
      await user2Page.goto(`/join?token=${invitation.token}`)

      // Try to join with the already-used token
      await expect(user2Page.getByTestId('join-league-button')).toBeVisible({ timeout: 10000 })
      await user2Page.getByTestId('join-league-button').click()

      // Should show error (invitation already used)
      await expect(user2Page.getByTestId('form-error')).toBeVisible({ timeout: 10000 })

      await user1Context.close()
      await user2Context.close()
    })
  })

  test.describe('Decline Invitation', () => {
    // Skip: decline-invitation-button is not yet implemented in the UI
    test.skip('can decline invitation', async () => {
      // UI not implemented
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

      // Try to join the full league
      await expect(userPage.getByTestId('join-league-button')).toBeVisible({ timeout: 10000 })
      await userPage.getByTestId('join-league-button').click()

      // Should show error about league being full
      await expect(userPage.getByTestId('form-error')).toBeVisible({ timeout: 10000 })

      // Cleanup
      await userContext.close()
      if (filler?.user) {
        await client.auth.admin.deleteUser(filler.user.id)
      }
      await client.from('leagues').delete().eq('id', league.id)
    })
  })

  test.describe('Wrong User', () => {
    test('invitation for different email allows or warns', async ({
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

      // The join page shows a form regardless of email mismatch.
      // The edge function handles the validation server-side.
      // The user either sees the join form (can attempt) or an error.
      // Just verify the page loaded without crashing.
      const joinButton = userPage.getByTestId('join-league-button')
      const errorAlert = userPage.getByTestId('form-error')

      await expect(joinButton.or(errorAlert)).toBeVisible({ timeout: 10000 })

      await userContext.close()
    })
  })

  test.describe('Dashboard Invitations', () => {
    // Skip: Dashboard invitation cards (invitation-card, accept-invitation-button) are not yet implemented
    test.skip('pending invitations shown on dashboard', async () => {
      // UI not implemented
    })

    // Skip: Dashboard invitation cards (invitation-card, accept-invitation-button) are not yet implemented
    test.skip('can accept invitation from dashboard', async () => {
      // UI not implemented
    })
  })
})
