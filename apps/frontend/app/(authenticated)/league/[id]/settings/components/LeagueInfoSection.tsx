'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Film } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, describedBy } from './shared'

interface Props {
  league: League
  onUpdate: (league: League) => void
}

const MAX_NAME_LENGTH = 255

interface UpdateInfoResponse {
  league: League
  message: string
}

export default function LeagueInfoSection({ league, onUpdate }: Props): React.ReactElement {
  const [name, setName] = useState(league.name)
  const [inviteOnly, setInviteOnly] = useState(league.invite_only)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const charCount = name.length
  const charsOver = charCount - MAX_NAME_LENGTH
  const isOverLimit = charsOver > 0
  const hasChanges = name.trim() !== league.name || inviteOnly !== league.invite_only
  const isSubmitDisabled = isSubmitting || isOverLimit || !name.trim() || !hasChanges

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setIsSubmitting(true)

    const { data, error } = await callEdgeFunction<UpdateInfoResponse>('update-league', {
      body: {
        action: 'update_info',
        league_id: league.id,
        name: name.trim(),
        invite_only: inviteOnly,
      },
    })

    setIsSubmitting(false)

    if (error) {
      toast.error(error)
      return
    }

    if (data?.league) {
      onUpdate(data.league)
      toast.success('League info updated')
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Film}
        title="League Info"
        description="Basic league settings"
      />

      <form onSubmit={handleSubmit}>
        {/* League Name */}
        <div className="mb-6">
          <label
            htmlFor="league_name"
            className="type-label block text-foreground-secondary mb-2"
          >
            League name
          </label>
          <input
            type="text"
            id="league_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter league name"
            className={`input ${isOverLimit ? 'border-error focus:border-error focus:shadow-[0_0_0_3px_var(--color-error-bg)]' : ''}`}
            maxLength={MAX_NAME_LENGTH + 10}
            required
            aria-invalid={isOverLimit || undefined}
            aria-describedby={describedBy('league_name_help', 'league_name_count', isOverLimit && 'league_name_error')}
          />
          <div className="flex justify-between mt-2">
            <p id="league_name_help" className="type-meta text-foreground-secondary">
              The name displayed to all participants
            </p>
            <span id="league_name_count" className={`type-numeric type-meta ${isOverLimit ? 'text-error' : 'text-foreground-secondary'}`}>
              <span aria-hidden="true">{charCount}/{MAX_NAME_LENGTH}</span>
              <span className="sr-only">{charCount} of {MAX_NAME_LENGTH} characters</span>
            </span>
          </div>
          {/* The red border and counter, in words. */}
          {isOverLimit && (
            <p id="league_name_error" role="alert" className="type-meta text-error mt-1">
              The name is {charsOver} {charsOver === 1 ? 'character' : 'characters'} too long.
            </p>
          )}
        </div>

        {/* Invite Only Toggle */}
        {/* The switch is named by "Invite only" alone and described by the line
            under it, so its name doesn't change every time it is flipped. */}
        <div className="mb-6 type-label flex items-center justify-between">
          <div>
            <label htmlFor="invite_only" className="type-label block text-foreground-secondary cursor-pointer">
              Invite only
            </label>
            <span id="invite_only_help" className="type-meta block text-foreground-secondary mt-0.5">
              {inviteOnly
                ? 'Only invited users can join this league'
                : 'Anyone with the link can join this league'}
            </span>
          </div>
          <button
            id="invite_only"
            type="button"
            role="switch"
            aria-checked={inviteOnly}
            aria-describedby="invite_only_help"
            onClick={() => setInviteOnly(!inviteOnly)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
              inviteOnly ? 'bg-gold' : 'bg-elevated'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                inviteOnly ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
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
    </section>
  )
}
