'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { FormError } from '@/app/components/FormError'
import type { League } from '@/types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (league: League) => void
}

interface CreateLeagueResponse {
  league: League
  participant: { id: string }
  team: { id: string; name: string }
}

const INITIAL_FORM_DATA = {
  name: '',
  team_name: '',
  max_participants: 8,
  invite_only: false,
}

export default function CreateLeagueModal({ isOpen, onClose, onSuccess }: Props): React.ReactElement | null {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError('Please enter a league name')
      return
    }

    setCreating(true)
    setError(null)

    const { data, error: createError } = await callEdgeFunction<CreateLeagueResponse>(
      'create-league',
      {
        body: {
          name: formData.name.trim(),
          invite_only: formData.invite_only,
          max_participants: formData.max_participants,
          team_name: formData.team_name.trim() || undefined,
        },
      }
    )

    if (createError) {
      setError(createError)
      setCreating(false)
      return
    }

    if (data?.league) {
      setFormData(INITIAL_FORM_DATA)
      onSuccess?.(data.league)
      onClose()
      router.push(`/league/${data.league.id}`)
    }

    setCreating(false)
  }

  function handleClose(): void {
    if (!creating) {
      setError(null)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
      <div
        className="glass card p-6 w-full max-w-lg animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold font-display text-foreground">
              Create New League
            </h2>
            <p className="text-sm text-foreground-muted mt-1">
              Set up your fantasy movie league
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={creating}
            className="text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* League Name */}
          <div>
            <label htmlFor="league-name" className="block text-sm font-medium text-foreground-secondary mb-1.5">
              League Name
            </label>
            <input
              type="text"
              id="league-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input"
              placeholder="e.g., Oscar Contenders 2026"
              required
              autoFocus
            />
          </div>

          {/* Team Name */}
          <div>
            <label htmlFor="team-name" className="block text-sm font-medium text-foreground-secondary mb-1.5">
              Your Team Name
              <span className="text-foreground-muted font-normal ml-1">(optional)</span>
            </label>
            <input
              type="text"
              id="team-name"
              value={formData.team_name}
              onChange={(e) => setFormData({ ...formData, team_name: e.target.value })}
              className="input"
              placeholder="e.g., Dreamworks Dynasty"
            />
          </div>

          {/* Max Participants & Invite Only - side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="max-participants" className="block text-sm font-medium text-foreground-secondary mb-1.5">
                Max Players
              </label>
              <input
                type="number"
                id="max-participants"
                value={formData.max_participants}
                onChange={(e) => setFormData({ ...formData, max_participants: parseInt(e.target.value) || 8 })}
                className="input"
                min="2"
                max="20"
              />
            </div>

            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.invite_only}
                  onChange={(e) => setFormData({ ...formData, invite_only: e.target.checked })}
                  className="h-4 w-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-background"
                />
                <span className="text-sm text-foreground group-hover:text-gold transition-colors">
                  Private League
                </span>
              </label>
            </div>
          </div>

          <FormError message={error} />

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={creating}
              className="btn btn-primary flex-1"
            >
              {creating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4\" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating...
                </>
              ) : (
                'Create League'
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={creating}
              className="btn btn-ghost px-6"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
