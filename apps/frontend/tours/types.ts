/**
 * The shape every guided tour shares. A tour is plain data: the engine
 * (`components/tours/`) decides when to show it, draws it, and records how it
 * ended. See docs/TOURS.md for how to add one.
 */
import type { LeagueStatus } from '@/types'

/**
 * What a page tells its tours about the viewer and the page, through
 * `<FeatureTour ctx={…}>`. The common facts are named here; a page may pass
 * anything else its own tour needs, and the tour reads it by key.
 */
export interface TourContext {
  isOwner?: boolean
  leagueStatus?: LeagueStatus
  /** The league has counterpicks (draft or bidding slots above zero). */
  counterpicksEnabled?: boolean
  [key: string]: unknown
}

/** Which side of its anchor a step's card prefers. `auto` picks whichever side has room. */
export type TourPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  /**
   * The `data-tour` value of the element this step points at. Several elements
   * may share one value (the desktop tabs and the mobile bottom bar); the
   * first one on screen wins. Leave it out for a centered step with no
   * highlight - an introduction or a closing note.
   */
  anchor?: string
  /** A short heading, sentence case, no trailing period. */
  title: string
  /** One or two short paragraphs. Say what the thing is for, not where it is. */
  body: string | string[]
  placement?: TourPlacement
  /** Leave the step out when this returns false - an owner-only control, say. */
  when?: (ctx: TourContext) => boolean
  /**
   * When the anchor is missing as the tour starts, the step is dropped. Set
   * this when its words still stand on their own as a centered card (a tab
   * hidden in the mobile "More" sheet, for instance).
   */
  centerIfMissing?: boolean
}

export interface TourDefinition {
  /** Stable, kebab-case. Stored per user, so never reuse one for a different tour. */
  id: string
  /**
   * Bump when the tour changes enough that people who saw the old one should
   * see it again: a redesigned page, a new feature on it. Copy edits don't
   * need a bump.
   */
  version: number
  /** Shown in account settings' Tours list and on the replay button's label. */
  title: string
  /** One line for that list: where the tour runs and what it covers. */
  description: string
  /** Whether the page's tour applies to this viewer right now. Default: always. */
  when?: (ctx: TourContext) => boolean
  /** When two tours on one page both apply, the higher priority goes first. Default 0. */
  priority?: number
  /** At most five. A tour that needs more is two tours. */
  steps: TourStep[]
}

/** Identity helper so a definition file gets checked against the shape without a cast. */
export function defineTour(tour: TourDefinition): TourDefinition {
  return tour
}
