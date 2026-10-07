'use client'

import { useState, useEffect } from 'react'
import { announce } from '@/utils/announce'
import { toast } from 'sonner'
import { Package } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage, NumberField } from './shared'

interface Props {
  league: League
  isLocked: boolean
  onUpdate: (league: League) => void
}

// Constraints
const MIN_TOTAL_SLOTS = 1
const MAX_TOTAL_SLOTS = 20
const MIN_DRAFT_SLOTS = 1
const MIN_DROP_LIMIT = 0
const MAX_DROP_LIMIT = 10
const MIN_COUNTERBID_HOURS = 1
const MAX_COUNTERBID_HOURS = 72
const MIN_NEW_BID_CUTOFF_HOURS = 0
const MAX_NEW_BID_CUTOFF_HOURS = 144

/**
 * The weekday+time an offset lands on, counting back from the weekly processing
 * deadline (Saturday 8pm UTC). Shown next to the input so a commissioner picking
 * "48" can see that it means Thursday rather than doing the arithmetic.
 */
function cutoffDayLabel(hours: number): string {
  // Any Saturday 20:00 UTC works -- only the weekday and time are read off.
  const referenceDeadline = Date.UTC(2026, 7, 15, 20, 0, 0)
  return new Date(referenceDeadline - hours * 3600_000).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

interface UpdateBiddingConfigResponse {
  league: League
  message: string
}

export default function BiddingConfigSection({
  league,
  isLocked,
  onUpdate,
}: Props): React.ReactElement {
  const [totalSlots, setTotalSlots] = useState(league.total_slots)
  const [draftSlots, setDraftSlots] = useState(league.draft_slots)
  const [dropLimit, setDropLimit] = useState(league.drop_limit)
  const [counterbidHours, setCounterbidHours] = useState(league.counterbid_hours)
  const [newBidCutoffHours, setNewBidCutoffHours] = useState(league.new_bid_cutoff_hours)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Ensure draft_slots doesn't exceed total_slots -- and say so, since the
  // change happens in a field the user isn't looking at.
  useEffect(() => {
    if (draftSlots > totalSlots) {
      setDraftSlots(totalSlots)
      announce(`Draft slots reduced to ${totalSlots} to fit the roster.`)
    }
  }, [totalSlots, draftSlots])

  const hasChanges =
    totalSlots !== league.total_slots ||
    draftSlots !== league.draft_slots ||
    dropLimit !== league.drop_limit ||
    counterbidHours !== league.counterbid_hours ||
    newBidCutoffHours !== league.new_bid_cutoff_hours

  // Validation
  const totalSlotsOutOfRange = totalSlots < MIN_TOTAL_SLOTS || totalSlots > MAX_TOTAL_SLOTS
  const draftSlotsOutOfRange = draftSlots < MIN_DRAFT_SLOTS || draftSlots > totalSlots
  const dropLimitOutOfRange = dropLimit < MIN_DROP_LIMIT || dropLimit > MAX_DROP_LIMIT
  const counterbidHoursOutOfRange = counterbidHours < MIN_COUNTERBID_HOURS || counterbidHours > MAX_COUNTERBID_HOURS
  const newBidCutoffOutOfRange =
    !Number.isInteger(newBidCutoffHours) ||
    newBidCutoffHours < MIN_NEW_BID_CUTOFF_HOURS ||
    newBidCutoffHours > MAX_NEW_BID_CUTOFF_HOURS
  const hasValidationError = totalSlotsOutOfRange || draftSlotsOutOfRange || dropLimitOutOfRange || counterbidHoursOutOfRange || newBidCutoffOutOfRange

  const isSubmitDisabled = isSubmitting || !hasChanges || hasValidationError || isLocked

  const pickupSlots = totalSlots - draftSlots

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setIsSubmitting(true)

    const { data, error } = await callEdgeFunction<UpdateBiddingConfigResponse>('update-league', {
      body: {
        action: 'update_bidding_config',
        league_id: league.id,
        total_slots: totalSlots,
        draft_slots: draftSlots,
        drop_limit: dropLimit,
        counterbid_hours: counterbidHours,
        new_bid_cutoff_hours: newBidCutoffHours,
      },
    })

    setIsSubmitting(false)

    if (error) {
      toast.error(error)
      return
    }

    if (data?.league) {
      onUpdate(data.league)
      toast.success('Bidding configuration updated')
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Package}
        title="Bidding Configuration"
        description={isLocked ? 'Locked after draft starts' : 'Roster slots and pickup settings'}
        isLocked={isLocked}
      />

      {isLocked ? (
        <LockedMessage
          message={`Bidding configuration cannot be changed after the draft has started. Current settings: ${league.draft_slots} draft slots, ${league.total_slots - league.draft_slots} pickup slots, ${league.drop_limit} max drops, ${league.counterbid_hours}h counterbid window, ${league.new_bid_cutoff_hours === 0 ? 'no new-bid cutoff' : `${league.new_bid_cutoff_hours}h new-bid cutoff`}.`}
        />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {/* Slot Configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumberField
                id="total_slots"
                label="Total roster slots"
                value={totalSlots}
                onChange={(raw) => setTotalSlots(parseInt(raw, 10) || MIN_TOTAL_SLOTS)}
                min={MIN_TOTAL_SLOTS}
                max={MAX_TOTAL_SLOTS}
                help={`Total movies per team (${MIN_TOTAL_SLOTS}-${MAX_TOTAL_SLOTS})`}
                error={totalSlotsOutOfRange ? `Must be between ${MIN_TOTAL_SLOTS} and ${MAX_TOTAL_SLOTS}` : null}
              />

              <NumberField
                id="draft_slots"
                label="Draft slots"
                value={draftSlots}
                onChange={(raw) => setDraftSlots(parseInt(raw, 10) || MIN_DRAFT_SLOTS)}
                min={MIN_DRAFT_SLOTS}
                max={totalSlots}
                help="Movies to draft (also = draft rounds)"
                error={draftSlotsOutOfRange ? `Must be between ${MIN_DRAFT_SLOTS} and ${totalSlots}` : null}
              />
            </div>

            {/* Roster slots are pooled: the draft fills some, bidding fills the
                rest, and a drop returns a slot to the same pool. */}
            <div className="p-3 bg-surface-hover rounded-lg border border-border">
              <div className="type-body-sm flex items-center justify-between">
                <span className="text-foreground-secondary">Open after the draft</span>
                <span className="font-medium text-gold">{pickupSlots} slots</span>
              </div>
              <p className="type-meta text-foreground-secondary mt-1">
                {pickupSlots > 0
                  ? `Teams draft ${draftSlots} and fill the remaining ${pickupSlots} of ${totalSlots} roster slots by bidding — or by dropping a movie and bidding on a replacement.`
                  : `The draft fills all ${totalSlots} roster slots. Teams can still bid by dropping a movie first.`}
              </p>
            </div>

            {/* Bidding Rules */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumberField
                id="drop_limit"
                label="Drop limit"
                value={dropLimit}
                onChange={(raw) => setDropLimit(parseInt(raw, 10) || MIN_DROP_LIMIT)}
                min={MIN_DROP_LIMIT}
                max={MAX_DROP_LIMIT}
                help={`Max drops per team per season (${MIN_DROP_LIMIT}-${MAX_DROP_LIMIT})`}
                error={dropLimitOutOfRange ? `Must be between ${MIN_DROP_LIMIT} and ${MAX_DROP_LIMIT}` : null}
              />

              <NumberField
                id="counterbid_hours"
                label="Counterbid window"
                unit="hours"
                value={counterbidHours}
                onChange={(raw) => setCounterbidHours(parseInt(raw, 10) || MIN_COUNTERBID_HOURS)}
                min={MIN_COUNTERBID_HOURS}
                max={MAX_COUNTERBID_HOURS}
                help={`Time to counter when outbid (${MIN_COUNTERBID_HOURS}-${MAX_COUNTERBID_HOURS}h)`}
                error={counterbidHoursOutOfRange ? `Must be between ${MIN_COUNTERBID_HOURS} and ${MAX_COUNTERBID_HOURS} hours` : null}
              />

              <NumberField
                id="new_bid_cutoff_hours"
                label="New bid cutoff"
                unit="hours before processing"
                value={newBidCutoffHours}
                onChange={(raw) => setNewBidCutoffHours(parseInt(raw, 10) || MIN_NEW_BID_CUTOFF_HOURS)}
                min={MIN_NEW_BID_CUTOFF_HOURS}
                max={MAX_NEW_BID_CUTOFF_HOURS}
                help={newBidCutoffHours === 0
                  ? 'New bids stay open all week (0 turns the cutoff off)'
                  : `After this point teams can only raise or counter bids already placed. ${newBidCutoffHours} puts the cutoff at ${cutoffDayLabel(newBidCutoffHours)}.`}
                error={newBidCutoffOutOfRange ? `Must be between ${MIN_NEW_BID_CUTOFF_HOURS} and ${MAX_NEW_BID_CUTOFF_HOURS} hours` : null}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="btn btn-primary mt-6"
          >
            {isSubmitting ? (
              <>
                <ButtonSpinner />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </form>
      )}
    </section>
  )
}
