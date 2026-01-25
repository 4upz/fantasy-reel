'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Target } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage } from './shared'

interface Props {
  league: League
  isLocked: boolean
  onUpdate: (league: League) => void
}

// Constraints
const MIN_DRAFT_COUNTERPICK_SLOTS = 0
const MAX_DRAFT_COUNTERPICK_SLOTS = 5
const MIN_BIDDING_COUNTERPICK_SLOTS = 0
const MAX_BIDDING_COUNTERPICK_SLOTS = 3

interface UpdateCounterpickConfigResponse {
  league: League
  message: string
}

export default function CounterpickConfigSection({
  league,
  isLocked,
  onUpdate,
}: Props): React.ReactElement {
  const [draftCounterpickSlots, setDraftCounterpickSlots] = useState(
    league.draft_counterpick_slots
  )
  const [biddingCounterpickSlots, setBiddingCounterpickSlots] = useState(
    league.bidding_counterpick_slots
  )
  const [counterpicksBlockDrops, setCounterpicksBlockDrops] = useState(
    league.counterpicks_block_drops
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasChanges =
    draftCounterpickSlots !== league.draft_counterpick_slots ||
    biddingCounterpickSlots !== league.bidding_counterpick_slots ||
    counterpicksBlockDrops !== league.counterpicks_block_drops

  // Validation
  const draftSlotsOutOfRange =
    draftCounterpickSlots < MIN_DRAFT_COUNTERPICK_SLOTS ||
    draftCounterpickSlots > MAX_DRAFT_COUNTERPICK_SLOTS
  const biddingSlotsOutOfRange =
    biddingCounterpickSlots < MIN_BIDDING_COUNTERPICK_SLOTS ||
    biddingCounterpickSlots > MAX_BIDDING_COUNTERPICK_SLOTS
  const hasValidationError = draftSlotsOutOfRange || biddingSlotsOutOfRange

  const isSubmitDisabled = isSubmitting || !hasChanges || hasValidationError || isLocked

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setIsSubmitting(true)

    const { data, error } = await callEdgeFunction<UpdateCounterpickConfigResponse>(
      'update-league',
      {
        body: {
          action: 'update_counterpick_config',
          league_id: league.id,
          draft_counterpick_slots: draftCounterpickSlots,
          bidding_counterpick_slots: biddingCounterpickSlots,
          counterpicks_block_drops: counterpicksBlockDrops,
        },
      }
    )

    setIsSubmitting(false)

    if (error) {
      toast.error(error)
      return
    }

    if (data?.league) {
      onUpdate(data.league)
      toast.success('Counterpick configuration updated')
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Target}
        title="Counterpick Configuration"
        description={isLocked ? 'Locked after draft starts' : 'Bet against opponent movies'}
        isLocked={isLocked}
      />

      {isLocked ? (
        <LockedMessage
          message={`Counterpick configuration cannot be changed after the draft has started. Current settings: ${league.draft_counterpick_slots} draft slots, ${league.bidding_counterpick_slots} bidding slots, drop blocking ${league.counterpicks_block_drops ? 'enabled' : 'disabled'}.`}
        />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {/* Counterpick Slots */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Draft Counterpick Slots */}
              <div>
                <label
                  htmlFor="draft_counterpick_slots"
                  className="block text-sm font-medium text-foreground-secondary mb-2"
                >
                  Draft Counterpick Slots
                </label>
                <input
                  type="number"
                  id="draft_counterpick_slots"
                  value={draftCounterpickSlots}
                  onChange={(e) =>
                    setDraftCounterpickSlots(
                      parseInt(e.target.value, 10) || MIN_DRAFT_COUNTERPICK_SLOTS
                    )
                  }
                  min={MIN_DRAFT_COUNTERPICK_SLOTS}
                  max={MAX_DRAFT_COUNTERPICK_SLOTS}
                  className={`input w-24 ${draftSlotsOutOfRange ? 'border-error focus:border-error' : ''}`}
                />
                <p className="text-xs text-foreground-muted mt-1.5">
                  Counterpicks per team after draft (0 to disable)
                </p>
                {draftSlotsOutOfRange && (
                  <p className="text-xs text-error mt-1">
                    Must be between {MIN_DRAFT_COUNTERPICK_SLOTS} and{' '}
                    {MAX_DRAFT_COUNTERPICK_SLOTS}
                  </p>
                )}
              </div>

              {/* Bidding Counterpick Slots */}
              <div>
                <label
                  htmlFor="bidding_counterpick_slots"
                  className="block text-sm font-medium text-foreground-secondary mb-2"
                >
                  Bidding Counterpick Slots
                </label>
                <input
                  type="number"
                  id="bidding_counterpick_slots"
                  value={biddingCounterpickSlots}
                  onChange={(e) =>
                    setBiddingCounterpickSlots(
                      parseInt(e.target.value, 10) || MIN_BIDDING_COUNTERPICK_SLOTS
                    )
                  }
                  min={MIN_BIDDING_COUNTERPICK_SLOTS}
                  max={MAX_BIDDING_COUNTERPICK_SLOTS}
                  className={`input w-24 ${biddingSlotsOutOfRange ? 'border-error focus:border-error' : ''}`}
                />
                <p className="text-xs text-foreground-muted mt-1.5">
                  Counterpicks per team during bidding (0 to disable)
                </p>
                {biddingSlotsOutOfRange && (
                  <p className="text-xs text-error mt-1">
                    Must be between {MIN_BIDDING_COUNTERPICK_SLOTS} and{' '}
                    {MAX_BIDDING_COUNTERPICK_SLOTS}
                  </p>
                )}
              </div>
            </div>

            {/* Counterpick Info */}
            <div className="p-3 bg-surface-hover rounded-lg border border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-secondary">Total Counterpicks Available</span>
                <span className="font-medium text-gold">
                  {draftCounterpickSlots + biddingCounterpickSlots} per team
                </span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                {draftCounterpickSlots > 0 || biddingCounterpickSlots > 0
                  ? 'Teams can bet against opponent movies to earn points if they underperform'
                  : 'Counterpicks are disabled. Enable by setting slots above 0.'}
              </p>
            </div>

            {/* Block Drops Toggle */}
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                <input
                  type="checkbox"
                  id="counterpicks_block_drops"
                  checked={counterpicksBlockDrops}
                  onChange={(e) => setCounterpicksBlockDrops(e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
                />
              </div>
              <div>
                <label
                  htmlFor="counterpicks_block_drops"
                  className="block text-sm font-medium text-foreground cursor-pointer"
                >
                  Block Drops on Counterpicked Movies
                </label>
                <p className="text-xs text-foreground-muted mt-1">
                  Prevent dropping movies that have been counterpicked by opponents
                </p>
              </div>
            </div>
          </div>

          <button type="submit" disabled={isSubmitDisabled} className="btn btn-primary mt-6">
            {isSubmitting ? (
              <>
                <ButtonSpinner />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </form>
      )}
    </section>
  )
}
