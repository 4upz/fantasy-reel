import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/auth.fixture'

const THEME_STORAGE_KEY = 'fantasy-reel:theme:v1'

async function expectTheme(
  page: Page,
  theme: 'light' | 'dark',
  preference: 'system' | 'light' | 'dark'
) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', preference)
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
}

function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  const record = (message: string) => {
    if (/hydration|hydrating|did not match|server rendered HTML|Minified React error #(418|423|425)\b/i.test(message)) {
      errors.push(message)
    }
  }
  page.on('console', message => {
    if (message.type() === 'error') record(message.text())
  })
  page.on('pageerror', error => record(error.message))
  return errors
}

test.describe('Theme preferences', () => {
  test('defaults to System and follows live device color changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/login')
    await expect(page.getByTestId('theme-select')).toBeEnabled()
    await expect(page.getByTestId('theme-select')).toHaveValue('system')
    await expectTheme(page, 'light', 'system')
    const lightBackground = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)

    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'dark', 'system')
    await expect(page.locator('body')).not.toHaveCSS('background-color', lightBackground)

    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'light', 'system')
    await expect(page.locator('body')).toHaveCSS('background-color', lightBackground)
  })

  test('manual choices persist across navigation and reload without hydration errors', async ({ page }) => {
    const hydrationErrors = collectHydrationErrors(page)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    await page.getByTestId('marketing-theme-button').click()
    await page.locator('#marketing-menu').getByText('Dark', { exact: true }).click()
    await expectTheme(page, 'dark', 'dark')
    expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark')
    await page.keyboard.press('Escape')

    await page.getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('link', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('/login')
    await expect(page.getByTestId('theme-select')).toHaveValue('dark')
    await expectTheme(page, 'dark', 'dark')

    await page.reload()
    await expect(page.getByTestId('theme-select')).toBeEnabled()
    await expectTheme(page, 'dark', 'dark')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'dark', 'dark')

    await page.getByTestId('theme-select').selectOption('light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'light', 'light')
    await page.reload()
    await expect(page.getByTestId('theme-select')).toHaveValue('light')
    await expectTheme(page, 'light', 'light')

    await page.getByTestId('theme-select').selectOption('system')
    await expectTheme(page, 'dark', 'system')
    expect(hydrationErrors).toEqual([])
  })

  test('resolves saved, missing, and invalid preferences before hydration', async ({ browser, baseURL }) => {
    const scenarios = [
      { stored: null, system: 'light', theme: 'light', preference: 'system' },
      { stored: null, system: 'dark', theme: 'dark', preference: 'system' },
      { stored: 'dark', system: 'light', theme: 'dark', preference: 'dark' },
      { stored: 'light', system: 'dark', theme: 'light', preference: 'light' },
      { stored: 'invalid', system: 'dark', theme: 'dark', preference: 'system' },
    ] as const

    for (const scenario of scenarios) {
      const context = await browser.newContext({ baseURL, colorScheme: scenario.system })
      try {
        await context.addInitScript(({ key, stored }) => {
          if (stored !== null) localStorage.setItem(key, stored)
        }, { key: THEME_STORAGE_KEY, stored: scenario.stored })
        let blockedScripts = 0
        await context.route('**/_next/**', route => {
          if (route.request().resourceType() === 'script') {
            blockedScripts += 1
            return route.abort()
          }
          return route.continue()
        })

        const page = await context.newPage()
        await page.goto('/login')
        await expectTheme(page, scenario.theme, scenario.preference)
        await expect(page.getByTestId('theme-select')).toBeDisabled()
        expect(blockedScripts).toBeGreaterThan(0)
      } finally {
        await context.close()
      }
    }
  })

  test('synchronizes manual choices and removed preferences between tabs', async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/login')
    const otherPage = await context.newPage()
    await otherPage.emulateMedia({ colorScheme: 'dark' })
    await otherPage.goto('/login')
    await expect(otherPage.getByTestId('theme-select')).toBeEnabled()

    await page.getByTestId('theme-select').selectOption('light')
    await expectTheme(otherPage, 'light', 'light')
    await expect(otherPage.getByTestId('theme-select')).toHaveValue('light')

    await otherPage.getByTestId('theme-select').selectOption('dark')
    await expectTheme(page, 'dark', 'dark')
    await expect(page.getByTestId('theme-select')).toHaveValue('dark')

    await otherPage.evaluate(key => localStorage.removeItem(key), THEME_STORAGE_KEY)
    await expectTheme(page, 'dark', 'system')
    await expect(page.getByTestId('theme-select')).toHaveValue('system')
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'light', 'system')
  })

  test('uses System and keeps manual controls working when theme storage is unavailable', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(key => {
      // Deny the app's preference storage without crashing Next 15's dev
      // overlay, which reads its own localStorage keys without a guard.
      const getItem = Storage.prototype.getItem
      const setItem = Storage.prototype.setItem
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new DOMException('Storage unavailable', 'SecurityError')
        return getItem.call(this, name)
      }
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Storage unavailable', 'SecurityError')
        setItem.call(this, name, value)
      }
    }, THEME_STORAGE_KEY)
    await page.route('**/_next/**', route => route.request().resourceType() === 'script'
      ? route.abort()
      : route.continue())
    await page.goto('/login')
    await expectTheme(page, 'dark', 'system')
    await expect(page.getByTestId('theme-select')).toBeDisabled()

    await page.unroute('**/_next/**')
    await page.reload()
    await page.getByTestId('theme-select').selectOption('light')
    await expectTheme(page, 'light', 'light')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'light', 'light')

    await page.getByTestId('theme-select').selectOption('system')
    await expectTheme(page, 'dark', 'system')
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'light', 'system')
  })

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'mobile', width: 375, height: 812 },
  ]) {
    test(`marketing navigation keeps theme controls tucked away on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.goto('/')

      const isMobile = viewport.name === 'mobile'
      const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true })
      await expect(navigation.getByRole('link', { name: 'How to play', exact: true })).toBeVisible()
      await expect(navigation.getByRole('link', { name: 'Sign up', exact: true })).toBeVisible()
      const signIn = page.locator('header').getByRole('link', { name: 'Sign in', exact: true })
      if (isMobile) {
        await expect(signIn).toBeHidden()
      } else {
        await expect(signIn).toBeVisible()
      }
      const trigger = page.getByTestId(isMobile ? 'marketing-menu-button' : 'marketing-theme-button')
      const menu = page.locator('#marketing-menu')
      const selector = menu.getByTestId('theme-selector')
      await expect(page.getByTestId('theme-select')).toHaveCount(0)
      await expect(selector).toBeHidden()
      await trigger.click()
      await expect(signIn).toBeVisible()
      await selector.getByText('Light', { exact: true }).click()
      await expectTheme(page, 'light', 'light')

      await selector.getByRole('radio', { name: 'Light', exact: true }).focus()
      await page.keyboard.press('ArrowRight')
      await expectTheme(page, 'dark', 'dark')
      await expect(selector.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
      const bounds = await menu.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)

      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.click()
      await page.locator('header').click({ position: { x: 4, y: 4 } })
      await expect(menu).toBeHidden()

      await page.reload()
      await trigger.click()
      await expect(selector.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
      await page.keyboard.press('Escape')
      await navigation.getByRole('link', { name: 'How to play', exact: true }).click()
      await page.waitForURL('/how-to-play')
      await expect(navigation.getByRole('link', { name: 'How to play', exact: true }))
        .toHaveAttribute('aria-current', 'page')
      await expectTheme(page, 'dark', 'dark')
      await trigger.click()
      await selector.getByText('System', { exact: true }).click()
      await page.emulateMedia({ colorScheme: 'light' })
      await expectTheme(page, 'light', 'system')
      if (!isMobile) await page.keyboard.press('Escape')
      await signIn.click()
      await page.waitForURL('/login')
    })

    test(`account menu and settings share accessible theme controls on ${viewport.name}`, async ({ authedPage: page }) => {
      const hydrationErrors = collectHydrationErrors(page)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.goto('/dashboard')
      await page.getByTestId('user-menu-button').click()
      const menuSelector = page.getByTestId('theme-selector')
      await menuSelector.getByText('Light', { exact: true }).click()
      await expect(menuSelector.getByRole('radio', { name: 'Light', exact: true })).toBeChecked()
      await expectTheme(page, 'light', 'light')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      await page.getByRole('link', { name: 'Account settings', exact: true }).click()
      await page.waitForURL('/settings')
      const appearance = page.getByRole('region', { name: 'Appearance', exact: true })
      await expect(appearance).toBeVisible()
      const settingsSelector = appearance.getByTestId('theme-selector')
      await expect(settingsSelector.getByRole('radio', { name: 'Light', exact: true })).toBeChecked()

      // Native radio keys should switch the theme as well as tapping its label.
      await settingsSelector.getByRole('radio', { name: 'Light', exact: true }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(settingsSelector.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
      await expectTheme(page, 'dark', 'dark')
      await page.reload()
      await expect(settingsSelector.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
      await settingsSelector.getByText('System', { exact: true }).click()
      await expectTheme(page, 'dark', 'system')
      await page.emulateMedia({ colorScheme: 'light' })
      await expectTheme(page, 'light', 'system')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(hydrationErrors).toEqual([])
    })
  }
})
