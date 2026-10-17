import type { TourDefinition } from './types'
import { welcomeTour } from './definitions/welcome'
import { leagueSetupTour } from './definitions/league-setup'
import { leagueSettingsTour } from './definitions/league-settings'
import { leagueWaitingTour } from './definitions/league-waiting'
import { draftRoomTour } from './definitions/draft-room'
import { counterpickRoundTour } from './definitions/counterpick-round'
import { biddingTour } from './definitions/bidding'

/**
 * Every tour, keyed by id, in the order a new player meets them - which is
 * also the order of the Tours list in account settings. Each key must equal
 * its tour's `id`; scripts/tests/tours.test.cjs checks that and more.
 */
export const TOURS = {
  welcome: welcomeTour,
  'league-setup': leagueSetupTour,
  'league-settings': leagueSettingsTour,
  'league-waiting': leagueWaitingTour,
  'draft-room': draftRoomTour,
  'counterpick-round': counterpickRoundTour,
  bidding: biddingTour,
} as const satisfies Record<string, TourDefinition>

export type TourId = keyof typeof TOURS

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
