/**
 * The tour engine's pure rules: what a stored outcome means, which tour a page
 * should start, and where a step's card goes. Free of React and the DOM so
 * scripts/tests/tours.test.cjs can check them directly.
 */
import type { TourContext, TourDefinition, TourPlacement, TourStep } from './types'

/**
 * How a tour ended for this user, as `record_tour_outcome()` stores it under
 * `user_ui_state` key `tour:<id>`:
 * - `completed`: reached the last step and pressed Finish.
 * - `dismissed`: chose "Don't show again", or snoozed it twice.
 * - `snoozed`: "Not now" (also Escape, the close button, or leaving the page
 *   mid-tour). Hidden until `until`, then offered once more.
 */
export type TourOutcome = 'completed' | 'dismissed' | 'snoozed'

export interface TourState {
  v: number
  status?: TourOutcome
  snoozes?: number
  until?: string
}

/** One `user_ui_state` row as the client reads it. */
export interface UiStateRow {
  key: string
  value: Record<string, unknown>
}

export const TOUR_KEY_PREFIX = 'tour:'
export const TOURS_PREF_KEY = 'prefs:tours'

export function tourKey(id: string): string {
  return `${TOUR_KEY_PREFIX}${id}`
}

/** Seen means finished or turned down at this version or a later one. */
export function isTourSeen(state: TourState | undefined, tour: Pick<TourDefinition, 'version'>): boolean {
  if (!state || state.v < tour.version) return false
  return state.status === 'completed' || state.status === 'dismissed'
}

/** Whether a tour may start by itself: unseen, and not inside a snooze. */
export function mayAutoStart(state: TourState | undefined, tour: Pick<TourDefinition, 'version'>, now: Date): boolean {
  if (!state || state.v < tour.version) return true
  if (state.status === 'snoozed') return !state.until || new Date(state.until).getTime() <= now.getTime()
  return state.status === undefined
}

/** Automatic tours are on unless the user turned them off. */
export function toursEnabled(pref: Record<string, unknown> | undefined): boolean {
  return pref?.enabled !== false
}

/** Does the tour apply to this page's context, and which of its steps do. */
export function applicableSteps(tour: TourDefinition, ctx: TourContext): TourStep[] {
  if (tour.when && !tour.when(ctx)) return []
  return tour.steps.filter((step) => !step.when || step.when(ctx))
}

export interface Candidate {
  tour: TourDefinition
  ctx: TourContext
  /** Mount order, for a stable tie-break. */
  order: number
}

/**
 * The tour a page should start by itself, if any: the applicable one with the
 * highest priority (earliest mounted on a tie) that may auto-start.
 */
export function pickAutoStart(
  candidates: Candidate[],
  states: ReadonlyMap<string, TourState>,
  now: Date
): Candidate | null {
  return (
    [...candidates]
      .filter((candidate) => applicableSteps(candidate.tour, candidate.ctx).length > 0)
      .filter((candidate) => candidate.tour.autoStart?.(candidate.ctx) ?? true)
      .filter((candidate) => mayAutoStart(states.get(candidate.tour.id), candidate.tour, now))
      .sort((a, b) => (b.tour.priority ?? 0) - (a.tour.priority ?? 0) || a.order - b.order)[0] ?? null
  )
}

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Fixed chrome the card must not cover: the mobile header above, the bottom bar below. */
export interface Insets {
  top: number
  bottom: number
}

export interface CardPosition {
  top: number
  left: number
  /** The card spans the screen, docked away from its anchor (narrow viewports). */
  docked: boolean
  /** Tallest the card may be before it scrolls inside itself (200% zoom). */
  maxHeight: number
}

/** Space kept between the card and the viewport edge or fixed chrome. */
export const VIEWPORT_MARGIN = 12
/** Space between the card and the highlighted element. */
export const ANCHOR_GAP = 14
/** Narrower than this, the card docks to the top or bottom instead of floating. */
export const DOCK_BELOW_WIDTH = 640

const AUTO_ORDER: Exclude<TourPlacement, 'auto'>[] = ['bottom', 'top', 'right', 'left']

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Where to put a step's card, inside the band the fixed chrome leaves free.
 * With no anchor it is centered. On a narrow screen it docks to whichever edge
 * is farther from the anchor, so it never covers what it points at. Otherwise
 * it sits beside the anchor on the preferred side, falling back through the
 * others to the first that fits, and is clamped to the band either way.
 */
export function placeCard(
  anchor: Box | null,
  card: Size,
  viewport: Size,
  insets: Insets = { top: 0, bottom: 0 },
  placement: TourPlacement = 'auto'
): CardPosition {
  const bandTop = insets.top + VIEWPORT_MARGIN
  const bandBottom = viewport.height - insets.bottom - VIEWPORT_MARGIN
  const maxHeight = Math.max(120, bandBottom - bandTop)
  const height = Math.min(card.height, maxHeight)
  const maxTop = bandBottom - height
  const maxLeft = viewport.width - card.width - VIEWPORT_MARGIN

  if (!anchor) {
    return {
      top: clamp(bandTop + (bandBottom - bandTop - height) / 2, bandTop, maxTop),
      left: clamp((viewport.width - card.width) / 2, VIEWPORT_MARGIN, maxLeft),
      docked: false,
      maxHeight,
    }
  }

  if (viewport.width < DOCK_BELOW_WIDTH) {
    const anchorMiddle = anchor.top + anchor.height / 2
    const bandMiddle = (bandTop + bandBottom) / 2
    return {
      top: anchorMiddle > bandMiddle ? bandTop : maxTop,
      left: VIEWPORT_MARGIN,
      docked: true,
      maxHeight,
    }
  }

  const centeredLeft = clamp(anchor.left + anchor.width / 2 - card.width / 2, VIEWPORT_MARGIN, maxLeft)
  const centeredTop = clamp(anchor.top + anchor.height / 2 - height / 2, bandTop, maxTop)
  const below = anchor.top + anchor.height + ANCHOR_GAP
  const above = anchor.top - ANCHOR_GAP - height
  const right = anchor.left + anchor.width + ANCHOR_GAP
  const left = anchor.left - ANCHOR_GAP - card.width
  const candidates: Record<Exclude<TourPlacement, 'auto'>, { top: number; left: number; fits: boolean }> = {
    bottom: { top: below, left: centeredLeft, fits: below + height <= bandBottom },
    top: { top: above, left: centeredLeft, fits: above >= bandTop },
    right: { top: centeredTop, left: right, fits: right + card.width <= viewport.width - VIEWPORT_MARGIN },
    left: { top: centeredTop, left, fits: left >= VIEWPORT_MARGIN },
  }

  const order = placement === 'auto' ? AUTO_ORDER : [placement, ...AUTO_ORDER.filter((side) => side !== placement)]
  const side = order.find((candidate) => candidates[candidate].fits)
  // Nothing fits beside a tall anchor (a whole page section): sit at the
  // bottom of the band, over its lower part, rather than off screen.
  const chosen = side ? candidates[side] : { top: maxTop, left: centeredLeft }

  return {
    top: clamp(chosen.top, bandTop, maxTop),
    left: clamp(chosen.left, VIEWPORT_MARGIN, maxLeft),
    docked: false,
    maxHeight,
  }
}
