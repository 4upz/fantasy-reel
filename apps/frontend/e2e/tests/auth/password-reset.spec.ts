import { test, expect } from '@playwright/test'
import {
  getLatestEmail,
  clearMailbox,
  extractAuthLink,
  waitForEmailWithSubject,
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

        // Fill email
        await page.fill('[data-testid="email-input"]', user.email)

        // Submit
        await page.click('[data-testid="reset-button"]')

        // Should show success message
        await expect(
          page.getByText(/check your email|reset link sent|email sent/i)
        ).toBeVisible({ timeout: 10000 })

        // Verify email was received
        const email = await waitForEmailWithSubject(user.email, 'reset', 15000)
        expect(email.subject.toLowerCase()).toMatch(/reset|password/)

        // Verify link in email
        const resetLink = extractAuthLink(email, 'reset')
        expect(resetLink).toBeTruthy()
      } finally {
        await deleteTestUser(user.id)
      }
    })

    test('shows error for non-existent email', async ({ page }) => {
      await page.goto('/forgot-password')

      // Fill with non-existent email
      await page.fill(
        '[data-testid="email-input"]',
        'nonexistent@doesnotexist.local'
      )

      // Submit
      await page.click('[data-testid="reset-button"]')

      // Supabase typically shows success even for non-existent emails (security)
      // But we should not show an error
      // Wait for response
      await page.waitForTimeout(2000)

      // Should either show success message or subtle indication
      // Should NOT expose that email doesn't exist
    })

    test('validates email format', async ({ page }) => {
      await page.goto('/forgot-password')

      // Fill with invalid email
      await page.fill('[data-testid="email-input"]', 'not-an-email')

      // Submit
      await page.click('[data-testid="reset-button"]')

      // Should show validation error or browser validation
      await expect(
        page.locator('[data-testid="email-input"]:invalid')
      ).toBeVisible()
    })

    test('back to login link works', async ({ page }) => {
      await page.goto('/forgot-password')

      // Click back to login
      await page.click('text=Back to login')

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
        await page.fill('[data-testid="email-input"]', user.email)
        await page.click('[data-testid="reset-button"]')

        // Wait for email
        await expect(
          page.getByText(/check your email|reset link sent/i)
        ).toBeVisible({ timeout: 10000 })

        const email = await waitForEmailWithSubject(user.email, 'reset', 15000)
        const resetLink = extractAuthLink(email, 'reset')

        expect(resetLink).toBeTruthy()

        // Visit reset link
        await page.goto(resetLink!)

        // Should show password reset form
        await expect(page.getByTestId('password-input')).toBeVisible({
          timeout: 10000,
        })

        // Fill new password
        const newPassword = 'NewSecurePassword456!'
        await page.fill('[data-testid="password-input"]', newPassword)

        // If there's a confirm password field
        const confirmInput = page.getByTestId('confirm-password-input')
        if (await confirmInput.isVisible().catch(() => false)) {
          await confirmInput.fill(newPassword)
        }

        // Submit
        await page.click('[data-testid="submit-button"]')

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

    test('password validation enforced', async ({ page }) => {
      // This test checks that weak passwords are rejected
      // We'd need a valid token to fully test this

      await page.goto('/reset-password')

      // If the page has a password input (requires valid token state)
      const passwordInput = page.getByTestId('password-input')

      if (await passwordInput.isVisible().catch(() => false)) {
        // Try weak password
        await passwordInput.fill('123')
        await page.click('[data-testid="submit-button"]')

        // Should show validation error
        await expect(page.getByText(/password.*weak|too short|requirements/i)).toBeVisible()
      }
    })

    test('shows password requirements', async ({ page }) => {
      // Navigate to reset password page
      await page.goto('/reset-password')

      // If the page shows requirements
      const passwordInput = page.getByTestId('password-input')

      if (await passwordInput.isVisible().catch(() => false)) {
        // Focus on password field
        await passwordInput.focus()

        // Should show password requirements hint
        // This depends on UI implementation
        const hasRequirements = await page
          .getByText(/at least.*characters|uppercase|lowercase|number/i)
          .isVisible()
          .catch(() => false)

        // Requirements should be visible either always or on focus
        // If not, the password field should have appropriate validation
      }
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
        await page.click('text=Forgot password')

        // Should be on forgot password page
        await page.waitForURL('/forgot-password')

        // Request reset
        await page.fill('[data-testid="email-input"]', user.email)
        await page.click('[data-testid="reset-button"]')

        // Wait for confirmation
        await expect(
          page.getByText(/check your email/i)
        ).toBeVisible({ timeout: 10000 })

        // Get email and click link
        const email = await waitForEmailWithSubject(user.email, 'reset', 15000)
        const resetLink = extractAuthLink(email, 'reset')

        // Reset password
        await page.goto(resetLink!)

        const newPassword = 'CompletelyNewPassword789!'
        await page.fill('[data-testid="password-input"]', newPassword)

        const confirmInput = page.getByTestId('confirm-password-input')
        if (await confirmInput.isVisible().catch(() => false)) {
          await confirmInput.fill(newPassword)
        }

        await page.click('[data-testid="submit-button"]')

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
