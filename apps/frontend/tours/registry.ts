import type { TourContext, TourDefinition } from './types'
import { biddingTour } from './definitions/bidding'

/**
 * Every tour, keyed by id, in the order a new player meets them - which is
 * also the order of the Tours list in account settings. Each key must equal
 * its tour's `id`; scripts/tests/tours.test.cjs checks that and more.
 */
export const TOURS = {
  bidding: biddingTour,
} as const satisfies Record<string, TourDefinition>

export type TourId = keyof typeof TOURS

/** The facts a tour reads, as its `defineTour<Ctx>()` declared them. */
export type TourCtx<Id extends TourId> = (typeof TOURS)[Id] extends TourDefinition<infer Ctx extends TourContext> ? Ctx : TourContext

/**
 * Ids that once named a tour. Progress is stored by id, so reusing one would
 * leave people marked as having seen a tour they never saw. Move an id here
 * when its tour is deleted.
 */
export const RETIRED_TOUR_IDS: readonly string[] = []

export const TOUR_LIST: readonly TourDefinition[] = Object.values(TOURS)

export function getTour(id: string): TourDefinition | undefined {
  return Object.hasOwn(TOURS, id) ? TOURS[id as TourId] : undefined
}
