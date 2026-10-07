'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage, describedBy } from './shared'

interface Props {
  league: League
  participantCount: number
  isLocked: boolean
  onUpdate: (league: League) => void
}

const MIN_PARTICIPANTS = 2
const MAX_PARTICIPANTS = 20

interface UpdateDraftConfigResponse {
  league: League
  message: string
}

export default function DraftConfigSection({
  league,
  participantCount,
  isLocked,
  onUpdate,
}: Props): React.ReactElement {
  // Held as typed: snapping an emptied field straight back to the minimum turned
  // typing "1" then "2" into "21" -- a change a screen-reader user never sees.
  const [maxParticipantsInput, setMaxParticipantsInput] = useState(String(league.max_participants))
  const [isSubmitting, setIsSubmitting] = useState(false)

  const maxParticipants = Number(maxParticipantsInput)
  const hasChanges = maxParticipants !== league.max_participants
  const isOutOfRange =
    maxParticipantsInput.trim() === '' ||
    !Number.isInteger(maxParticipants) ||
    maxParticipants < MIN_PARTICIPANTS ||
    maxParticipants > MAX_PARTICIPANTS
  const isBelowCurrent = !isOutOfRange && maxParticipants < participantCount
  const isSubmitDisabled = isSubmitting || !hasChanges || isBelowCurrent || isOutOfRange || isLocked
  const fieldError = isOutOfRange
    ? `Must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}`
    : isBelowCurrent
      ? `Cannot set below current participant count (${participantCount})`
      : null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setIsSubmitting(true)

    const { data, error } = await callEdgeFunction<UpdateDraftConfigResponse>('update-league', {
      body: {
        action: 'update_draft_config',
        league_id: league.id,
        max_participants: maxParticipants,
      },
    })

    setIsSubmitting(false)

    if (error) {
      toast.error(error)
      return
    }

    if (data?.league) {
      onUpdate(data.league)
      toast.success('Draft configuration updated')
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Users}
        title="Draft Configuration"
        description={isLocked ? 'Locked after draft starts' : 'Participant limits'}
        isLocked={isLocked}
      />

      {isLocked ? (
        <LockedMessage
          message={`Draft configuration cannot be changed after the draft has started. Current limit: ${league.max_participants} participants`}
        />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="max_participants"
              className="type-label block text-foreground-secondary mb-2"
            >
              Maximum participants
            </label>
            <input
              type="number"
              id="max_participants"
              value={maxParticipantsInput}
              onChange={(e) => setMaxParticipantsInput(e.target.value)}
              min={MIN_PARTICIPANTS}
              max={MAX_PARTICIPANTS}
              required
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={describedBy('max_participants_help', fieldError && 'max_participants_error')}
              className={`type-input type-numeric input w-32 ${fieldError ? 'border-error focus:border-error' : ''}`}
            />
            <div className="mt-2 space-y-1">
              <p id="max_participants_help" className="type-meta text-foreground-secondary">
                Current participants: {participantCount} / {league.max_participants}
              </p>
              {fieldError && (
                <p id="max_participants_error" role="alert" className="type-meta text-error">
                  {fieldError}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="btn btn-primary"
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
