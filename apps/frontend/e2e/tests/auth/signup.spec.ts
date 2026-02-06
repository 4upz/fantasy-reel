import { test, expect } from '@playwright/test'
import {
  captureEmailBaseline,
  waitForNewEmail,
  clearMailbox,
  extractAuthLink,
} from '../../helpers/email.helper'
import { generateTestEmail } from '../../fixtures/test-data'
import { deleteTestUser, getAdminClient } from '../../helpers/supabase.helper'

/**
 * Signup flow E2E tests
 * Tests complete signup flow including email verification via Inbucket
 */
test.describe('User Signup', () => {
  let testEmail: string

  test.beforeEach(async () => {
    // Generate unique email for this test
    testEmail = generateTestEmail('signup')
    // Clear any existing emails
    await clearMailbox(testEmail)
  })

  test.afterEach(async () => {
    // Clean up test user if created
    try {
      const client = getAdminClient()
      const { data } = await client.auth.admin.listUsers()
      const testUser = data?.users.find((u) => u.email === testEmail)
      if (testUser) {
        await deleteTestUser(testUser.id)
      }
    } catch {
      // Ignore cleanup errors
    }
  })

  test('complete signup flow with email verification @critical', async ({ page }) => {
    await page.goto('/signup')

    // Capture email baseline BEFORE triggering signup
    const baseline = await captureEmailBaseline(testEmail)

    // Fill signup form
    await page.fill('[data-testid="display-name-input"]', 'E2E Test User')
    await page.fill('[data-testid="email-input"]', testEmail)
    await page.fill('[data-testid="password-input"]', 'SecurePassword123!')
    await page.fill('#confirmPassword', 'SecurePassword123!')

    // Submit form
    await page.click('[data-testid="signup-button"]')

    // Wait for form submission to complete
    await page.waitForLoadState('networkidle')

    // Should show confirmation message (heading)
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15000 })

    // Wait for NEW confirmation email (after baseline)
    const email = await waitForNewEmail(testEmail, baseline, 15000)
    expect(email.subject.toLowerCase()).toContain('confirm')

    // Extract and visit confirmation link
    const confirmLink = extractAuthLink(email, 'confirm')
    expect(confirmLink).toBeTruthy()

    await page.goto(confirmLink!)

    // Should redirect to login with success message
    await page.waitForURL('/login', { timeout: 10000 })
    await expect(page.getByText(/email confirmed|verified/i)).toBeVisible()
  })

  test('shows validation errors for invalid input', async ({ page }) => {
    await page.goto('/signup')

    // Submit empty form
    await page.click('[data-testid="signup-button"]')

    // Wait for form submission to complete
    await page.waitForLoadState('networkidle')

    // Should show validation errors - check for aria-invalid or visible error messages
    // Browser validation marks required fields as invalid
    const displayNameInput = page.getByTestId('display-name-input')
    const emailInput = page.getByTestId('email-input')

    // Check that form validation prevents submission (inputs should remain required/invalid)
    const isDisplayNameInvalid = await displayNameInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    )
    const isEmailInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    )

    expect(isDisplayNameInvalid).toBe(true)
    expect(isEmailInvalid).toBe(true)
  })

  test('shows error for weak password', async ({ page }) => {
    await page.goto('/signup')

    await page.fill('[data-testid="display-name-input"]', 'Test User')
    await page.fill('[data-testid="email-input"]', testEmail)
    await page.fill('[data-testid="password-input"]', '123') // Too short
    await page.fill('#confirmPassword', '123')

    await page.click('[data-testid="signup-button"]')

    // Should show password requirement error
    await expect(page.getByText(/password/i)).toBeVisible()
  })

  test('shows error for invalid email format', async ({ page }) => {
    await page.goto('/signup')

    await page.fill('[data-testid="display-name-input"]', 'Test User')
    await page.fill('[data-testid="email-input"]', 'not-an-email')
    await page.fill('[data-testid="password-input"]', 'SecurePassword123!')
    await page.fill('#confirmPassword', 'SecurePassword123!')

    await page.click('[data-testid="signup-button"]')

    // Wait for form submission attempt
    await page.waitForLoadState('networkidle')

    // Browser validation should prevent submission - check validity state
    const emailInput = page.getByTestId('email-input')
    const isEmailInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    )
    expect(isEmailInvalid).toBe(true)
  })

  test('login link navigates correctly', async ({ page }) => {
    await page.goto('/signup')

    // Click login link - use role-based selector for stability
    await page.getByRole('link', { name: /sign in/i }).click()

    // Should navigate to login page
    await page.waitForURL('/login')
  })
})

test.describe('Duplicate Email Handling', () => {
  test('shows error for already registered email', async ({ page }) => {
    const existingEmail = generateTestEmail('existing')

    // First signup
    await page.goto('/signup')
    await page.fill('[data-testid="display-name-input"]', 'First User')
    await page.fill('[data-testid="email-input"]', existingEmail)
    await page.fill('[data-testid="password-input"]', 'Password123!')
    await page.fill('#confirmPassword', 'Password123!')
    await page.click('[data-testid="signup-button"]')

    // Wait for form submission to complete
    await page.waitForLoadState('networkidle')

    // Wait for first signup to complete
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15000 })

    // Second signup with same email
    await page.goto('/signup')
    await page.fill('[data-testid="display-name-input"]', 'Second User')
    await page.fill('[data-testid="email-input"]', existingEmail)
    await page.fill('[data-testid="password-input"]', 'Password456!')
    await page.fill('#confirmPassword', 'Password456!')
    await page.click('[data-testid="signup-button"]')

    // Should show error about existing email
    // Note: Supabase may return generic error for security
    await expect(page.getByText(/already registered|error|unable/i)).toBeVisible({ timeout: 10000 })

    // Clean up
    try {
      const client = getAdminClient()
      const { data } = await client.auth.admin.listUsers()
      const testUser = data?.users.find((u) => u.email === existingEmail)
      if (testUser) {
        await deleteTestUser(testUser.id)
      }
    } catch {
      // Ignore cleanup errors
    }
  })
})
