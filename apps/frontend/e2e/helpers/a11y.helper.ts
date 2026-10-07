import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import fs from 'fs'
import path from 'path'

/**
 * Accessibility scanning for E2E tests.
 *
 * Runs axe-core against WCAG 2.0/2.1/2.2 A and AA plus axe's best-practice
 * rules, the ruleset screen-reader support depends on: names, roles, states,
 * landmarks, headings, contrast, and focus order. A violation fails the test.
 *
 * Set A11Y_REPORT_DIR to also write each scan to JSON (used to build the
 * baseline in docs/ACCESSIBILITY.md).
 */
export const A11Y_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
]

export interface A11yViolation {
  id: string
  impact: string | null | undefined
  help: string
  nodes: Array<{ target: string; html: string; summary?: string }>
}

interface ScanOptions {
  /** Limit the scan to this selector, e.g. an open dialog. */
  include?: string
}

export async function scanA11y(
  page: Page,
  testInfo: TestInfo,
  label: string,
  options: ScanOptions = {}
): Promise<A11yViolation[]> {
  // Let entrance animations finish so contrast is measured on final colors.
  await page.waitForTimeout(400)
  // `next dev` floats its indicator badge over the page corner, where it
  // overlaps real targets; production builds (CI) don't render it.
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach(el => el.remove()))

  let builder = new AxeBuilder({ page }).withTags(A11Y_TAGS)
  if (options.include) builder = builder.include(options.include)

  const results = await builder.analyze()
  const violations: A11yViolation[] = results.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map(n => ({
      target: n.target.join(' '),
      html: n.html.slice(0, 240),
      summary: n.failureSummary,
    })),
  }))

  const reportDir = process.env.A11Y_REPORT_DIR
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true })
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'unknown')
    const viewport = page.viewportSize()
    const file = path.join(
      reportDir,
      `${testInfo.titlePath.slice(1).join(' -- ')} -- ${label}`.replace(/[^\w.-]+/g, '_').slice(0, 180) + '.json'
    )
    fs.writeFileSync(file, JSON.stringify({
      label,
      url: new URL(page.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id'),
      theme,
      viewport: viewport ? `${viewport.width}x${viewport.height}` : null,
      passes: results.passes.length,
      violations,
    }, null, 2))
  }

  expect.soft(
    violations.map(v => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map(n => n.target).join('\n    ')}`),
    `axe violations on "${label}"`
  ).toEqual([])

  return violations
}

/**
 * Screen-reader contract every page must meet beyond what axe checks:
 * a page-specific <title> (announced by Next's route announcer on client
 * navigation), exactly one <h1>, one <main> that the skip link targets.
 */
export async function expectPageStructure(page: Page, label: string): Promise<string> {
  const title = await page.title()
  expect.soft(title, `${label}: <title> should name the page, not just the app`).not.toBe('Fantasy Reel')
  expect.soft(title, `${label}: <title> should end with the app name`).toMatch(/^Fantasy Reel — |\| Fantasy Reel$/)
  await expect.soft(page.locator('h1'), `${label}: exactly one <h1>`).toHaveCount(1)
  await expect.soft(page.locator('main'), `${label}: exactly one <main>`).toHaveCount(1)
  await expect.soft(page.locator('main#main-content'), `${label}: <main> is the skip-link target`).toHaveCount(1)
  await expect.soft(page.locator('a.skip-link[href="#main-content"]'), `${label}: skip link`).toHaveCount(1)
  return title
}

/**
 * Keyboard and screen-reader contract for a modal dialog: opening it from the
 * keyboard moves focus inside, it has a name, Tab never escapes to the page
 * behind it, Escape closes it, and focus returns to the control that opened it.
 * Returns the open dialog so the caller can scan it before it is closed.
 */
export async function openDialogFromKeyboard(page: Page, trigger: Locator, label: string): Promise<Locator> {
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog').last()
  await expect(dialog, `${label}: opens`).toBeVisible()
  await expect.soft(dialog, `${label}: has an accessible name`).toHaveAccessibleName(/\S/)
  await expect.poll(
    () => dialog.evaluate(d => d.contains(document.activeElement)),
    { message: `${label}: focus moves into the dialog` }
  ).toBe(true)
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    // Null while focus is inside the top-most open dialog; otherwise where it went.
    const escapedTo = await page.evaluate(() => {
      const open = [...document.querySelectorAll('dialog[open]')]
      const top = open[open.length - 1]
      const active = document.activeElement
      if (!active || active === document.body || top?.contains(active)) return null
      return active.outerHTML.slice(0, 200)
    })
    expect.soft(escapedTo, `${label}: Tab stays inside the dialog`).toBeNull()
    if (escapedTo) break
  }
  return dialog
}

export async function closeDialogWithEscape(page: Page, dialog: Locator, trigger: Locator, label: string): Promise<void> {
  await page.keyboard.press('Escape')
  await expect.soft(dialog, `${label}: Escape closes it`).toBeHidden()
  await expect.soft(trigger, `${label}: focus returns to the trigger`).toBeFocused()
}

/** Wait for an element that only renders once the page's data has loaded. */
export async function waitForReady(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 20000 })
}
