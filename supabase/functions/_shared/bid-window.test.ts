/**
 * Unit tests for the new-bid cutoff arithmetic.
 *
 * Pure -- no database. The fixture week is the real one the feature is
 * specified against: processing Saturday 2026-08-15 20:00 UTC, so a 48-hour
 * cutoff must land on Thursday 2026-08-13 20:00 UTC.
 */

import { assertEquals } from '@std/assert'
import {
  computeBidWindow,
  isBidCancellable,
  newBidClosedMessage,
  cancelClosedMessage,
  DEFAULT_NEW_BID_CUTOFF_HOURS,
  MAX_NEW_BID_CUTOFF_HOURS,
} from './bid-window.ts'

const PROCESSING_DEADLINE = '2026-08-15T20:00:00.000Z' // Saturday 8pm UTC
const EXPECTED_CUTOFF = '2026-08-13T20:00:00.000Z' // Thursday 8pm UTC

const WEDNESDAY = new Date('2026-08-12T12:00:00.000Z')
const THURSDAY_JUST_BEFORE = new Date('2026-08-13T19:59:59.999Z')
const THURSDAY_EXACTLY = new Date('2026-08-13T20:00:00.000Z')
const FRIDAY = new Date('2026-08-14T12:00:00.000Z')
const AFTER_PROCESSING = new Date('2026-08-15T21:00:00.000Z')

// ============================================================================
// computeBidWindow
// ============================================================================

Deno.test('48h cutoff on a Saturday 8pm deadline lands Thursday 8pm UTC', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, DEFAULT_NEW_BID_CUTOFF_HOURS, WEDNESDAY)
  assertEquals(window.cutoffAt?.toISOString(), EXPECTED_CUTOFF)
  assertEquals(window.cutoffAt?.getUTCDay(), 4) // Thursday
})

Deno.test('open phase before the cutoff', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, WEDNESDAY)
  assertEquals(window.isCounterBidPhase, false)
})

Deno.test('still open one millisecond before the cutoff', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, THURSDAY_JUST_BEFORE)
  assertEquals(window.isCounterBidPhase, false)
})

Deno.test('counter-bid phase begins exactly at the cutoff instant', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, THURSDAY_EXACTLY)
  assertEquals(window.isCounterBidPhase, true)
})

Deno.test('counter-bid phase persists after the cutoff', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, FRIDAY)
  assertEquals(window.isCounterBidPhase, true)
})

Deno.test('cutoff of 0 disables the rule entirely', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 0, FRIDAY)
  assertEquals(window.cutoffAt, null)
  assertEquals(window.isCounterBidPhase, false)
})

Deno.test('missing or malformed config degrades to disabled, never to locked out', () => {
  for (const bad of [null, undefined, NaN, Infinity, -12]) {
    const window = computeBidWindow(PROCESSING_DEADLINE, bad as number, FRIDAY)
    assertEquals(window.cutoffAt, null, `cutoffHours=${bad}`)
    assertEquals(window.isCounterBidPhase, false, `cutoffHours=${bad}`)
  }
})

Deno.test('an unparseable deadline degrades to disabled', () => {
  const window = computeBidWindow('not-a-date', 48, FRIDAY)
  assertEquals(window.cutoffAt, null)
  assertEquals(window.isCounterBidPhase, false)
})

Deno.test('accepts a Date as well as an ISO string', () => {
  const fromDate = computeBidWindow(new Date(PROCESSING_DEADLINE), 48, WEDNESDAY)
  const fromString = computeBidWindow(PROCESSING_DEADLINE, 48, WEDNESDAY)
  assertEquals(fromDate.cutoffAt?.toISOString(), fromString.cutoffAt?.toISOString())
})

Deno.test('non-default offsets shift the cutoff by whole hours', () => {
  assertEquals(
    computeBidWindow(PROCESSING_DEADLINE, 24, WEDNESDAY).cutoffAt?.toISOString(),
    '2026-08-14T20:00:00.000Z', // Friday 8pm
  )
  assertEquals(
    computeBidWindow(PROCESSING_DEADLINE, 72, WEDNESDAY).cutoffAt?.toISOString(),
    '2026-08-12T20:00:00.000Z', // Wednesday 8pm
  )
})

Deno.test('the maximum offset still leaves 24h of open bidding', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, MAX_NEW_BID_CUTOFF_HOURS, WEDNESDAY)
  const cycleStart = new Date(new Date(PROCESSING_DEADLINE).getTime() - 168 * 3600_000)
  const openHours = (window.cutoffAt!.getTime() - cycleStart.getTime()) / 3600_000
  assertEquals(openHours, 24)
})

// ============================================================================
// isBidCancellable
// ============================================================================

Deno.test('cancelling is allowed in the open phase', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, WEDNESDAY)
  assertEquals(isBidCancellable(PROCESSING_DEADLINE, window, WEDNESDAY), true)
})

Deno.test('cancelling is blocked in the counter-bid phase', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, FRIDAY)
  assertEquals(isBidCancellable(PROCESSING_DEADLINE, window, FRIDAY), false)
})

Deno.test('cancelling is blocked for a bid past its own deadline, even once the cycle rolls over', () => {
  // After Saturday 8pm the next cutoff is days out, so the phase is open again --
  // but this bid is still awaiting the hourly process-bids run and must not be
  // withdrawable in that gap.
  const nextCycle = computeBidWindow('2026-08-22T20:00:00.000Z', 48, AFTER_PROCESSING)
  assertEquals(nextCycle.isCounterBidPhase, false)
  assertEquals(isBidCancellable(PROCESSING_DEADLINE, nextCycle, AFTER_PROCESSING), false)
})

Deno.test('a bid in the next cycle is cancellable while the old one is not', () => {
  const nextCycle = computeBidWindow('2026-08-22T20:00:00.000Z', 48, AFTER_PROCESSING)
  assertEquals(isBidCancellable('2026-08-22T20:00:00.000Z', nextCycle, AFTER_PROCESSING), true)
})

Deno.test('a missing or unparseable bid deadline does not block cancelling on its own', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, WEDNESDAY)
  assertEquals(isBidCancellable(null, window, WEDNESDAY), true)
  assertEquals(isBidCancellable('nonsense', window, WEDNESDAY), true)
})

Deno.test('a disabled cutoff still blocks cancelling a bid in processing', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 0, AFTER_PROCESSING)
  assertEquals(window.isCounterBidPhase, false)
  assertEquals(isBidCancellable(PROCESSING_DEADLINE, window, AFTER_PROCESSING), false)
})

// ============================================================================
// Messages
// ============================================================================

Deno.test('refusal messages name the cutoff and what is still allowed', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 48, FRIDAY)

  const newBid = newBidClosedMessage(window)
  assertEquals(newBid.includes('Thu'), true)
  assertEquals(newBid.includes('8:00'), true)
  assertEquals(newBid.includes('raise or counter'), true)

  const cancel = cancelClosedMessage(window)
  assertEquals(cancel.includes('Thu'), true)
  assertEquals(cancel.includes('withdrawn'), true)
})

Deno.test('refusal messages stay readable when the cutoff is disabled', () => {
  const window = computeBidWindow(PROCESSING_DEADLINE, 0, FRIDAY)
  assertEquals(newBidClosedMessage(window).includes('undefined'), false)
  assertEquals(cancelClosedMessage(window).includes('null'), false)
})
