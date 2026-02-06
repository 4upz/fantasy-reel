import { test, expect } from '@playwright/test'
import {
  captureEmailBaseline,
  waitForNewEmail,
  clearMailbox,
  extractAuthLink,
} from '../../helpers/email.helper'
import { createTestUser, deleteTestUser } from '../../helpers/supabase.helper'

/**
 * Password Reset E2E tests
 * Tests the forgot password and reset password flows
 */
test.describe('Password Reset', () => {
  test.describe('Forgot Password Page', () => {
    test('can request password reset email @critical', async ({ page }) => {
      // Create a test user first
      const user = await createTestUser('reset')

      try {
        // Clear any existing emails
        await clearMailbox(user.email)

        await page.goto('/forgot-password')

        // Verify we're on the forgot-password page
        await expect(page.getByTestId('reset-button')).toBeVisible({ timeout: 10000 })

        // Capture email baseline BEFORE triggering reset
        const baseline = await captureEmailBaseline(user.email)

        // Fill email
        await page.getByTestId('email-input').fill(user.email)

        // Submit
        await page.getByTestId('reset-button').click()

        // Should show success message (heading)
        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 15000 })

        // Wait for NEW email (after baseline)
        const email = await waitForNewEmail(user.email, baseline, 15000)
        expect(email.subject.toLowerCase()).toMatch(/reset|password/)

        // Verify link in email
        const resetLink = extractAuthLink(email, 'reset')
        expect(resetLink).toBeTruthy()
      } finally {
        await deleteTestUser(user.id)
      }
    })

    test('shows success for non-existent email (security)', async ({ page }) => {
      await page.goto('/forgot-password')

      // Fill with non-existent email
      await page.getByTestId('email-input').fill('nonexistent@doesnotexist.local')

      // Submit
      await page.getByTestId('reset-button').click()

      // Supabase shows success even for non-existent emails (security best practice)
      // Should NOT expose that email doesn't exist
      // Instead should show same "check your email" message
      await expect(
        page.getByRole('heading', { name: /check your email/i })
      ).toBeVisible({ timeout: 10000 })
    })

    test('validates email format', async ({ page }) => {
      await page.goto('/forgot-password')

      // Fill with invalid email
      await page.getByTestId('email-input').fill('not-an-email')

      // Submit
      await page.getByTestId('reset-button').click()

      // Browser validation should prevent submission - check validity state
      const emailInput = page.getByTestId('email-input')
      const isEmailInvalid = await emailInput.evaluate(
        (el: HTMLInputElement) => !el.validity.valid
      )
      expect(isEmailInvalid).toBe(true)
    })

    test('back to login link works', async ({ page }) => {
      await page.goto('/forgot-password')

      // Click back to login
      await page.getByTestId('back-to-login-link').click()

      // Should navigate to login page
      await page.waitForURL('/login')
    })
  })

  test.describe('Reset Password Page', () => {
    test('reset password with valid token @critical', async ({ page }) => {
      // Create user and request reset
      const user = await createTestUser('reset-valid')

      try {
        await clearMailbox(user.email)

        // Request reset
        await page.goto('/forgot-password')

        // Capture email baseline BEFORE triggering reset
        const baseline = await captureEmailBaseline(user.email)

        await page.getByTestId('email-input').fill(user.email)
        await page.getByTestId('reset-button').click()

        // Wait for confirmation message (heading)
        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 15000 })

        // Wait for NEW email (after baseline)
        const email = await waitForNewEmail(user.email, baseline, 15000)
        const resetLink = extractAuthLink(email, 'reset')

        expect(resetLink).toBeTruthy()

        // Visit reset link - goes through Supabase auth confirm, redirects to /reset-password
        await page.goto(resetLink!)
        await page.waitForURL(/\/reset-password/, { timeout: 15000 })

        // Should show password reset form
        const passwordInput = page.getByTestId('password-input')
        await expect(passwordInput).toBeVisible({ timeout: 10000 })

        // Fill new password
        const newPassword = 'NewSecurePassword456!'
        await passwordInput.fill(newPassword)

        // Fill confirm password (always visible on this page)
        await page.getByTestId('confirm-password-input').fill(newPassword)

        // Submit
        await page.getByTestId('submit-button').click()

        // Should show success message - target the alert specifically to avoid
        // matching both the FormSuccess div and the toast
        await expect(
          page.getByTestId('form-success')
        ).toBeVisible({ timeout: 10000 })

        // Click "Sign in with new password" link to go to login
        await page.getByRole('link', { name: /sign in/i }).click()

        // Verify can login with new password
        await page.waitForURL('/login')
        await page.getByTestId('email-input').fill(user.email)
        await page.getByTestId('password-input').fill(newPassword)
        await page.getByTestId('login-button').click()

        await page.waitForURL('/dashboard')
      } finally {
        await deleteTestUser(user.id)
      }
    })

    test('shows error for expired token', async ({ page }) => {
      // Navigate to reset page with invalid/expired token
      await page.goto('/reset-password#access_token=expired_token_12345')

      // Should show "Invalid or Expired Link" heading
      await expect(
        page.getByRole('heading', { name: /invalid or expired/i })
      ).toBeVisible({ timeout: 10000 })
    })

    // Skip: requires valid token state which is complex to set up
    test.skip('password validation enforced', async ({ page }) => {
      // This test checks that weak passwords are rejected
      // We'd need a valid token to fully test this
    })

    // Skip: requires valid token state which is complex to set up
    test.skip('shows password requirements', async ({ page }) => {
      // Navigate to reset password page and check for hints
    })
  })

  test.describe('Reset Flow Integration', () => {
    test('complete reset flow from login page @critical', async ({ page }) => {
      // Create user
      const user = await createTestUser('reset-full')

      try {
        await clearMailbox(user.email)

        // Start from login page
        await page.goto('/login')

        // Click forgot password link
        await page.getByTestId('forgot-password-link').click()

        // Should be on forgot password page
        await page.waitForURL('/forgot-password')

        // Capture email baseline BEFORE triggering reset
        const baseline = await captureEmailBaseline(user.email)

        // Request reset
        await page.getByTestId('email-input').fill(user.email)
        await page.getByTestId('reset-button').click()

        // Wait for confirmation (heading)
        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 15000 })

        // Wait for NEW email (after baseline)
        const email = await waitForNewEmail(user.email, baseline, 15000)
        const resetLink = extractAuthLink(email, 'reset')

        // Reset password - the link goes through Supabase auth confirm which redirects to /reset-password
        await page.goto(resetLink!)
        await page.waitForURL(/\/reset-password/, { timeout: 15000 })

        // Wait for form to appear and be interactive
        const passwordInput = page.getByTestId('password-input')
        await expect(passwordInput).toBeVisible({ timeout: 10000 })

        const newPassword = 'CompletelyNewPassword789!'
        await passwordInput.fill(newPassword)
        await page.getByTestId('confirm-password-input').fill(newPassword)

        await page.getByTestId('submit-button').click()

        // Should show success - target alert specifically
        await expect(
          page.getByTestId('form-success')
        ).toBeVisible({ timeout: 10000 })

        // Click "Sign in with new password" link to navigate to login
        await page.getByRole('link', { name: /sign in/i }).click()
        await page.waitForURL('/login')

        // Verify old password doesn't work
        await page.getByTestId('email-input').fill(user.email)
        await page.getByTestId('password-input').fill(user.password) // Old password
        await page.getByTestId('login-button').click()

        await expect(
          page.locator('form').getByText(/invalid email or password/i)
        ).toBeVisible()

        // Verify new password works (re-fill email since form clears after failed attempt)
        await page.getByTestId('email-input').fill(user.email)
        await page.getByTestId('password-input').fill(newPassword)
        await page.getByTestId('login-button').click()

        await page.waitForURL('/dashboard')
      } finally {
        await deleteTestUser(user.id)
      }
    })
  })
})
