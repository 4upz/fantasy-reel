import type { Insets } from '@/tours/engine'

/**
 * The modal dialog on top, if any. `:modal` matches only dialogs opened with
 * showModal(); a non-modal `<dialog open>` (a popover) doesn't make the page
 * inert, so it doesn't count. Of several modals the last opened is on top, and
 * each later one sits after its opener in the DOM, so the last match wins.
 */
export function topModal(): HTMLDialogElement | null {
  const modals = document.querySelectorAll<HTMLDialogElement>('dialog:modal')
  return modals[modals.length - 1] ?? null
}

function isShown(element: HTMLElement): boolean {
  if (element.closest('[inert]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  return getComputedStyle(element).visibility !== 'hidden'
}

/**
 * The element a tour step points at: the first `[data-tour="name"]` on
 * screen. Several elements may carry one name (the desktop tabs and the mobile
 * bottom bar) and only one is visible at a time.
 */
export function findTourAnchor(name: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`)
  for (const element of candidates) {
    if (isShown(element)) return element
  }
  return null
}

/**
 * A short name for what a step highlights, for screen readers: the element's
 * label, else its first heading, else its text, cut to a phrase.
 */
export function describeAnchor(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby')
  const label = element.getAttribute('aria-label')
    ?? (labelledBy ? document.getElementById(labelledBy.split(' ')[0])?.textContent : null)
    ?? (element.querySelector<HTMLElement>('h1, h2, h3, h4, legend')?.innerText || null)
    ?? element.innerText
  const text = (label ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text
}

/**
 * How much of the viewport fixed chrome covers: elements marked
 * `data-tour-inset="top"` (the mobile header, the pinned league header),
 * `data-tour-inset="bottom"` (the mobile tab bar) and `data-tour-inset="left"`
 * (the desktop side navigation). Only what is on screen counts, and only while
 * it is pinned (fixed or sticky). A piece floating just off the edge, like the
 * desktop account capsule, counts as touching it.
 */
/** How far from the edge (or the piece before it) chrome may float and still count. */
const FLOATING_GAP = 16

export function measureInsets(): Insets {
  const viewportHeight = window.innerHeight
  const rects = (edge: 'top' | 'bottom' | 'left') =>
    [...document.querySelectorAll<HTMLElement>(`[data-tour-inset="${edge}"]`)]
      .filter((element) => isShown(element) && ['fixed', 'sticky'].includes(getComputedStyle(element).position))
      .map((element) => element.getBoundingClientRect())

  // Chrome stacks: the league header pins just below the app header. Walk
  // outward from each edge and keep extending while the next piece touches.
  let top = 0
  for (const rect of rects('top').sort((a, b) => a.top - b.top)) {
    if (rect.top <= top + FLOATING_GAP) top = Math.max(top, rect.bottom)
  }
  let bottom = 0
  for (const rect of rects('bottom').sort((a, b) => b.bottom - a.bottom)) {
    if (rect.bottom >= viewportHeight - bottom - 1) bottom = Math.max(bottom, viewportHeight - rect.top)
  }
  const left = Math.max(0, ...rects('left').filter((rect) => rect.left <= 1).map((rect) => rect.right))
  return { top, bottom, left }
}
