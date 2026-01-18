'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Film } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader } from './shared'

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
  const isOverLimit = charCount > MAX_NAME_LENGTH
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
            className="block text-sm font-medium text-foreground-secondary mb-2"
          >
            League Name
          </label>
          <input
            type="text"
            id="league_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter league name"
            className={`input ${isOverLimit ? 'border-error focus:border-error focus:shadow-[0_0_0_3px_var(--color-error-bg)]' : ''}`}
            maxLength={MAX_NAME_LENGTH + 10}
          />
          <div className="flex justify-between mt-2">
            <p className="text-xs text-foreground-muted">
              The name displayed to all participants
            </p>
            <span className={`text-xs ${isOverLimit ? 'text-error' : 'text-foreground-muted'}`}>
              {charCount}/{MAX_NAME_LENGTH}
            </span>
          </div>
        </div>

        {/* Invite Only Toggle */}
        <div className="mb-6">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="block text-sm font-medium text-foreground-secondary">
                Invite Only
              </span>
              <span className="block text-xs text-foreground-muted mt-0.5">
                {inviteOnly
                  ? 'Only invited users can join this league'
                  : 'Anyone with the link can join this league'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={inviteOnly}
              onClick={() => setInviteOnly(!inviteOnly)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                inviteOnly ? 'bg-gold' : 'bg-elevated'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  inviteOnly ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>
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
    </section>
  )
}
