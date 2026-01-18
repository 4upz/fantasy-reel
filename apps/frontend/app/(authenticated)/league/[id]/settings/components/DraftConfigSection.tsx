'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage } from './shared'

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
  const [maxParticipants, setMaxParticipants] = useState(league.max_participants)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasChanges = maxParticipants !== league.max_participants
  const isBelowCurrent = maxParticipants < participantCount
  const isOutOfRange = maxParticipants < MIN_PARTICIPANTS || maxParticipants > MAX_PARTICIPANTS
  const isSubmitDisabled = isSubmitting || !hasChanges || isBelowCurrent || isOutOfRange || isLocked

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
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              Maximum Participants
            </label>
            <input
              type="number"
              id="max_participants"
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(parseInt(e.target.value, 10) || MIN_PARTICIPANTS)}
              min={MIN_PARTICIPANTS}
              max={MAX_PARTICIPANTS}
              className={`input w-32 ${isBelowCurrent || isOutOfRange ? 'border-error focus:border-error' : ''}`}
            />
            <div className="mt-2 space-y-1">
              <p className="text-xs text-foreground-muted">
                Current participants: {participantCount} / {league.max_participants}
              </p>
              {isBelowCurrent && (
                <p className="text-xs text-error">
                  Cannot set below current participant count ({participantCount})
                </p>
              )}
              {isOutOfRange && !isBelowCurrent && (
                <p className="text-xs text-error">
                  Must be between {MIN_PARTICIPANTS} and {MAX_PARTICIPANTS}
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
              'Save Changes'
            )}
          </button>
        </form>
      )}
    </section>
  )
}
