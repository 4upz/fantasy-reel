import { test, expect } from '@playwright/test'
import {
  captureEmailBaseline,
  waitForNewEmail,
  clearMailbox,
  extractAuthLink,
} from '../../helpers/email.helper'
import { createTestUser, deleteTestUser } from '../../helpers/supabase.helper'
import { generateTestEmail } from '../../fixtures/test-data'

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
        await page.waitForLoadState('networkidle')

        // Verify we're on the forgot-password page
        await expect(page.getByTestId('reset-button')).toBeVisible({ timeout: 10000 })

        // Capture email baseline BEFORE triggering reset
        const baseline = await captureEmailBaseline(user.email)

        // Fill email
        await page.fill('[data-testid="email-input"]', user.email)

        // Submit
        await page.click('[data-testid="reset-button"]')

        // Wait for form submission to complete
        await page.waitForLoadState('networkidle')

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
      await page.fill(
        '[data-testid="email-input"]',
        'nonexistent@doesnotexist.local'
      )

      // Submit
      await page.click('[data-testid="reset-button"]')

      // Wait for form submission to complete
      await page.waitForLoadState('networkidle')

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
      await page.fill('[data-testid="email-input"]', 'not-an-email')

      // Submit
      await page.click('[data-testid="reset-button"]')

      // Wait for form submission attempt
      await page.waitForLoadState('networkidle')

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
      await page.click('[data-testid="back-to-login-link"]')

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

        await page.fill('[data-testid="email-input"]', user.email)
        await page.click('[data-testid="reset-button"]')

        // Wait for form submission to complete
        await page.waitForLoadState('networkidle')

        // Wait for confirmation message (heading)
        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 15000 })

        // Wait for NEW email (after baseline)
        const email = await waitForNewEmail(user.email, baseline, 15000)
        const resetLink = extractAuthLink(email, 'reset')

        expect(resetLink).toBeTruthy()

        // Visit reset link
        await page.goto(resetLink!)
        await page.waitForLoadState('networkidle')

        // Should show password reset form
        await expect(page.getByTestId('password-input')).toBeVisible({
          timeout: 10000,
        })

        // Fill new password
        const newPassword = 'NewSecurePassword456!'
        await page.fill('[data-testid="password-input"]', newPassword)

        // Fill confirm password if the field exists
        const confirmInput = page.getByTestId('confirm-password-input')
        const confirmVisible = await confirmInput.isVisible({ timeout: 1000 }).catch(() => false)
        if (confirmVisible) {
          await confirmInput.fill(newPassword)
        }

        // Submit
        await page.click('[data-testid="submit-button"]')
        await page.waitForLoadState('networkidle')

        // Should show success and redirect to login
        await expect(
          page.getByText(/password.*updated|password.*changed|success/i)
        ).toBeVisible({ timeout: 10000 })

        // Verify can login with new password
        await page.goto('/login')
        await page.fill('[data-testid="email-input"]', user.email)
        await page.fill('[data-testid="password-input"]', newPassword)
        await page.click('[data-testid="login-button"]')

        await page.waitForURL('/dashboard')
      } finally {
        await deleteTestUser(user.id)
      }
    })

    test('shows error for expired token', async ({ page }) => {
      // Navigate to reset page with invalid/expired token
      await page.goto('/reset-password#access_token=expired_token_12345')

      // Should show error about expired/invalid token
      await expect(
        page.getByText(/expired|invalid|error/i)
      ).toBeVisible({ timeout: 10000 })
    })

    // Skip: requires valid token state which is complex to set up
    test.skip('password validation enforced', async ({ page }) => {
      // This test checks that weak passwords are rejected
      // We'd need a valid token to fully test this

      await page.goto('/reset-password')

      const passwordInput = page.getByTestId('password-input')

      // Try weak password
      await passwordInput.fill('123')
      await page.click('[data-testid="submit-button"]')

      // Should show validation error
      await expect(page.getByText(/password.*weak|too short|requirements/i)).toBeVisible()
    })

    // Skip: requires valid token state which is complex to set up
    test.skip('shows password requirements', async ({ page }) => {
      // Navigate to reset password page
      await page.goto('/reset-password')

      const passwordInput = page.getByTestId('password-input')

      // Focus on password field
      await passwordInput.focus()

      // Should show password requirements hint
      await expect(
        page.getByText(/at least.*characters|uppercase|lowercase|number/i)
      ).toBeVisible()
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
        await page.click('[data-testid="forgot-password-link"]')

        // Should be on forgot password page
        await page.waitForURL('/forgot-password')

        // Capture email baseline BEFORE triggering reset
        const baseline = await captureEmailBaseline(user.email)

        // Request reset
        await page.fill('[data-testid="email-input"]', user.email)
        await page.click('[data-testid="reset-button"]')

        // Wait for form submission to complete
        await page.waitForLoadState('networkidle')

        // Wait for confirmation (heading)
        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 15000 })

        // Wait for NEW email (after baseline)
        const email = await waitForNewEmail(user.email, baseline, 15000)
        const resetLink = extractAuthLink(email, 'reset')

        // Reset password
        await page.goto(resetLink!)
        await page.waitForLoadState('networkidle')

        const newPassword = 'CompletelyNewPassword789!'
        await page.fill('[data-testid="password-input"]', newPassword)

        // Fill confirm password if the field exists
        const confirmInput = page.getByTestId('confirm-password-input')
        const confirmVisible = await confirmInput.isVisible({ timeout: 1000 }).catch(() => false)
        if (confirmVisible) {
          await confirmInput.fill(newPassword)
        }

        await page.click('[data-testid="submit-button"]')
        await page.waitForLoadState('networkidle')

        // Should redirect to login
        await page.waitForURL('/login', { timeout: 10000 })

        // Verify old password doesn't work
        await page.fill('[data-testid="email-input"]', user.email)
        await page.fill('[data-testid="password-input"]', user.password) // Old password
        await page.click('[data-testid="login-button"]')

        await expect(page.getByText(/invalid.*credentials/i)).toBeVisible()

        // Verify new password works
        await page.fill('[data-testid="password-input"]', newPassword)
        await page.click('[data-testid="login-button"]')

        await page.waitForURL('/dashboard')
      } finally {
        await deleteTestUser(user.id)
      }
    })
  })
})
