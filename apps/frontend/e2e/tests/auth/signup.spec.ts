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
    await page.getByTestId('display-name-input').fill('E2E Test User')
    await page.getByTestId('email-input').fill(testEmail)
    await page.getByTestId('password-input').fill('SecurePassword123!')
    // confirmPassword field uses id-based selector (no data-testid)
    await page.locator('#confirmPassword').fill('SecurePassword123!')

    // Submit form
    await page.getByTestId('signup-button').click()

    // Should show confirmation message (heading)
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15000 })

    // Wait for NEW confirmation email (after baseline)
    const email = await waitForNewEmail(testEmail, baseline, 15000)
    expect(email.subject.toLowerCase()).toContain('confirm')

    // Extract and visit confirmation link
    const confirmLink = extractAuthLink(email, 'confirm')
    expect(confirmLink).toBeTruthy()

    await page.goto(confirmLink!)

    // Should redirect to login or dashboard after confirmation
    // Supabase auth confirm may redirect through intermediate pages
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 15000 })
  })

  test('shows validation errors for invalid input', async ({ page }) => {
    await page.goto('/signup')

    // Submit empty form
    await page.getByTestId('signup-button').click()

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

    await page.getByTestId('display-name-input').fill('Test User')
    await page.getByTestId('email-input').fill(testEmail)
    await page.getByTestId('password-input').fill('123') // Too short
    await page.locator('#confirmPassword').fill('123')

    await page.getByTestId('signup-button').click()

    // Should show password requirement error in the form's alert area
    // Use the form-scoped alert to avoid matching the password label/placeholder
    await expect(page.getByTestId('form-error')).toBeVisible({ timeout: 10000 })
  })

  test('shows error for invalid email format', async ({ page }) => {
    await page.goto('/signup')

    await page.getByTestId('display-name-input').fill('Test User')
    await page.getByTestId('email-input').fill('not-an-email')
    await page.getByTestId('password-input').fill('SecurePassword123!')
    await page.locator('#confirmPassword').fill('SecurePassword123!')

    await page.getByTestId('signup-button').click()

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
  test('shows success or error for already registered email', async ({ page }) => {
    const existingEmail = generateTestEmail('existing')

    // First signup
    await page.goto('/signup')
    await page.getByTestId('display-name-input').fill('First User')
    await page.getByTestId('email-input').fill(existingEmail)
    await page.getByTestId('password-input').fill('Password123!')
    await page.locator('#confirmPassword').fill('Password123!')
    await page.getByTestId('signup-button').click()

    // Wait for first signup to complete
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15000 })

    // Second signup with same email
    await page.goto('/signup')
    await page.getByTestId('display-name-input').fill('Second User')
    await page.getByTestId('email-input').fill(existingEmail)
    await page.getByTestId('password-input').fill('Password456!')
    await page.locator('#confirmPassword').fill('Password456!')
    await page.getByTestId('signup-button').click()

    // Supabase may show "check your email" again (security: doesn't reveal if email exists)
    // OR show an error. Either is valid behavior.
    // Wait for the page to respond (either success heading or error alert)
    await expect(
      page.getByRole('heading', { name: /check your email/i }).or(page.getByTestId('form-error'))
    ).toBeVisible({ timeout: 15000 })

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
