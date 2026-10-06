import { test, expect, type Page } from '@playwright/test'
import {
  captureEmailBaseline,
  waitForNewEmail,
  clearMailbox,
  extractAuthLink,
} from '../../helpers/email.helper'
import { generateTestEmail } from '../../fixtures/test-data'
import { createTestUser, deleteTestUser, getAdminClient } from '../../helpers/supabase.helper'

/**
 * /auth/confirm must only sign in the browser that asked for the email.
 * Otherwise anyone could send their own confirmation link to someone else and
 * sign that person into the sender's account (login CSRF).
 */

async function findUserId(email: string): Promise<string | undefined> {
  const client = getAdminClient()
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const user = data.users.find((user) => user.email === email)
    if (user || data.users.length < 100) return user?.id
  }
}

async function isEmailConfirmed(userId: string): Promise<boolean> {
  const { data, error } = await getAdminClient().auth.admin.getUserById(userId)
  if (error) throw error
  return Boolean(data.user?.email_confirmed_at)
}

/** Signs up through the UI and returns the token hash from the confirmation email. */
async function signUpAndGetTokenHash(page: Page, email: string): Promise<string> {
  await page.goto('/signup')
  const baseline = await captureEmailBaseline(email)

  await page.getByTestId('display-name-input').fill('Link Binding User')
  await page.getByTestId('email-input').fill(email)
  await page.getByTestId('password-input').fill('SecurePassword123!')
  await page.locator('#confirmPassword').fill('SecurePassword123!')
  await page.getByTestId('signup-button').click()
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15000 })

  const message = await waitForNewEmail(email, baseline, 15000)
  const link = extractAuthLink(message, 'confirm')
  expect(link).toBeTruthy()

  const url = new URL(link!)
  const tokenHash = url.searchParams.get('token_hash') ?? url.searchParams.get('token')
  expect(tokenHash, 'App sign-ups use the PKCE flow').toMatch(/^pkce_/)
  return tokenHash!
}

async function expectSignedOut(page: Page): Promise<void> {
  await page.goto('/dashboard')
  await page.waitForURL(/\/login/, { timeout: 15000 })
}

test.describe('Email link binding', () => {
  let testEmail: string

  test.beforeEach(async () => {
    testEmail = generateTestEmail('link-binding')
    await clearMailbox(testEmail)
  })

  test.afterEach(async () => {
    const userId = await findUserId(testEmail).catch(() => undefined)
    if (userId) await deleteTestUser(userId)
  })

  test('confirm link signs in the browser that signed up @critical', async ({ page }) => {
    const tokenHash = await signUpAndGetTokenHash(page, testEmail)

    await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=signup`)
    await page.waitForURL(/\/dashboard/, { timeout: 15000 })

    const userId = await findUserId(testEmail)
    expect(await isEmailConfirmed(userId!)).toBe(true)
  })

  test('confirm link opened in another browser confirms without signing in @critical', async ({
    page,
    browser,
  }) => {
    const tokenHash = await signUpAndGetTokenHash(page, testEmail)

    const otherContext = await browser.newContext()
    try {
      const other = await otherContext.newPage()
      await other.goto(`/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=email`)
      await other.waitForURL(/\/login/, { timeout: 15000 })
      await expect(other.getByTestId('link-notice')).toBeVisible()
      await expectSignedOut(other)
    } finally {
      await otherContext.close()
    }

    const userId = await findUserId(testEmail)
    expect(await isEmailConfirmed(userId!)).toBe(true)
  })

  test('non-PKCE confirmation token confirms without signing in', async ({ page }) => {
    const { data, error } = await getAdminClient().auth.admin.generateLink({
      type: 'signup',
      email: testEmail,
      password: 'SecurePassword123!',
    })
    expect(error).toBeNull()
    const tokenHash = data.properties!.hashed_token

    await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=signup`)
    await page.waitForURL(/\/login\?notice=email_confirmed/, { timeout: 15000 })
    await expect(page.getByTestId('form-success')).toBeVisible()
    await expectSignedOut(page)

    expect(await isEmailConfirmed(data.user!.id)).toBe(true)
  })

  test('non-PKCE recovery token does not sign in', async ({ page }) => {
    const user = await createTestUser('link-binding-recovery')
    try {
      const { data, error } = await getAdminClient().auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
      })
      expect(error).toBeNull()

      await page.goto(
        `/auth/confirm?token_hash=${encodeURIComponent(data.properties!.hashed_token)}&type=recovery`
      )
      await page.waitForURL(/\/auth\/auth-code-error/, { timeout: 15000 })
      await expectSignedOut(page)
    } finally {
      await deleteTestUser(user.id)
    }
  })
})
