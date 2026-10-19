/**
 * The shape every guided tour shares. A tour is plain data: the engine
 * (`components/tours/`) decides when to show it, draws it, and records how it
 * ended. See docs/TOURS.md for how to add one.
 */
import type { LeagueStatus } from '@/types'

/**
 * What a page tells its tours about the viewer and the page, through
 * `<FeatureTour ctx={…}>`. The facts several tours share are named here. A
 * tour declares the exact facts it reads with `defineTour<Ctx>()`, and then
 * `<FeatureTour>` for that tour won't compile without them.
 */
export interface TourContext {
  isOwner?: boolean
  leagueStatus?: LeagueStatus
  /** The league has counterpicks (draft or bidding slots above zero). */
  counterpicksEnabled?: boolean
  /** Hasn't played a season yet (no active or completed season). Beginner tours start only for them. */
  newPlayer?: boolean
  /**
   * The page's own data has arrived. Pass `false` while a skeleton shows, so a
   * `when` that reads the data isn't judged on placeholders.
   */
  loaded?: boolean
  [key: string]: unknown
}

/** Which side of its anchor a step's card prefers. `auto` picks whichever side has room. */
export type TourPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

export type StepBody = string | string[]

/**
 * A function of the page's ctx. Written as a method so a tour typed for its
 * own facts still fits the registry's general `TourDefinition`.
 */
type CtxFn<Ctx, Result> = { fn(ctx: Ctx): Result }['fn']

export interface TourStep<Ctx extends TourContext = TourContext> {
  /**
   * The `data-tour` value of the element this step points at. Several elements
   * may share one value (the desktop tabs and the mobile bottom bar); the
   * first one on screen wins. Leave it out for a centered step with no
   * highlight - an introduction or a closing note.
   */
  anchor?: string
  /** A short heading, sentence case, no trailing period. */
  title: string
  /**
   * One or two short paragraphs. Say what the thing is for, not where it is.
   * A function gets the page's ctx when the tour starts, for wording that
   * depends on the viewer or the league (the length of the trade review).
   */
  body: StepBody | CtxFn<Ctx, StepBody>
  placement?: TourPlacement
  /** Leave the step out when this returns false - an owner-only control, say. */
  when?(ctx: Ctx): boolean
  /**
   * When the anchor is missing as the tour starts, the step is dropped. Set
   * this when its words still stand on their own as a centered card (a tab
   * hidden in the mobile "More" sheet, for instance).
   */
  centerIfMissing?: boolean
}

export interface TourDefinition<Ctx extends TourContext = TourContext> {
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
  when?(ctx: Ctx): boolean
  /**
   * Whether the tour may start by itself for this viewer. Default: always.
   * `when` decides whether the tour applies at all (and so whether it can be
   * replayed); this only keeps it from starting unasked, e.g. beginner tours
   * for someone who has already played a season.
   */
  autoStart?(ctx: Ctx): boolean
  /**
   * A step a newcomer needs right then (creating or joining a first league,
   * the draft): it starts by itself even within the gap after another
   * automatic tour. Leave it off for feature tours.
   */
  essential?: boolean
  /** At most five. A tour that needs more is two tours. */
  steps: TourStep<Ctx>[]
}

/**
 * Identity helper so a definition file gets checked against the shape without
 * a cast. Name the facts the tour reads as `Ctx`, and pages offering it must
 * pass them:
 *
 * @example defineTour<{ leagueStatus: LeagueStatus; counterpicksEnabled: boolean }>({ … })
 */
export function defineTour<Ctx extends TourContext = TourContext>(tour: TourDefinition<Ctx>): TourDefinition<Ctx> {
  return tour
}

/** A step as it shows: `body` resolved against the page's ctx. */
export type ResolvedStep = Omit<TourStep, 'body'> & { body: StepBody }
