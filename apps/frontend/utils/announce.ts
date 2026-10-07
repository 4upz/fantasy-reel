/**
 * Speak a message to screen readers without moving focus.
 *
 * Use it for changes a sighted user notices but a screen-reader user would
 * not: a realtime draft pick, "it's your turn", "link copied", a saved
 * setting, a result count after a search. Errors the user must act on use
 * `assertive`; everything else stays `polite`.
 *
 * The live region is created lazily and reused. While a modal <dialog> is
 * open, everything outside it is inert - and inert live regions are silent -
 * so the message goes to a region inside the top-most open dialog instead.
 *
 * Inline messages that stay on screen (form errors, empty states) should use
 * role="alert" / role="status" in place instead; this is for transient news.
 */
export type Politeness = 'polite' | 'assertive'

const ANNOUNCE_DELAY_MS = 100

function liveRegion(politeness: Politeness): HTMLElement {
  const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
  const host: HTMLElement = openDialogs.length ? openDialogs[openDialogs.length - 1] : document.body
  let region = host.querySelector<HTMLElement>(`:scope > [data-live-announcer="${politeness}"]`)
  if (!region) {
    region = document.createElement('div')
    region.dataset.liveAnnouncer = politeness
    region.className = 'sr-only'
    region.setAttribute('aria-live', politeness)
    region.setAttribute('aria-atomic', 'true')
    host.appendChild(region)
  }
  return region
}

export function announce(message: string, politeness: Politeness = 'polite'): void {
  if (typeof document === 'undefined' || !message) return
  // Clear first so repeating the same message is announced again, and give a
  // just-created region a moment to register before it changes.
  liveRegion(politeness).textContent = ''
  // Resolve the region again when speaking: a dialog that was open at call
  // time may have closed (taking its region with it) in the meantime.
  window.setTimeout(() => { liveRegion(politeness).textContent = message }, ANNOUNCE_DELAY_MS)
}
