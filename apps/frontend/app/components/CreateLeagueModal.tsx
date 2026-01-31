'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
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

// Constraints (matching settings page and database)
const MIN_TOTAL_SLOTS = 1
const MAX_TOTAL_SLOTS = 20
const MIN_DRAFT_SLOTS = 1
const MIN_DROP_LIMIT = 0
const MAX_DROP_LIMIT = 10
const MIN_COUNTERBID_HOURS = 1
const MAX_COUNTERBID_HOURS = 72
const MIN_DRAFT_COUNTERPICK_SLOTS = 0
const MAX_DRAFT_COUNTERPICK_SLOTS = 5
const MIN_BIDDING_COUNTERPICK_SLOTS = 0
const MAX_BIDDING_COUNTERPICK_SLOTS = 3

const INITIAL_FORM_DATA = {
  name: '',
  team_name: '',
  max_participants: 8,
  invite_only: false,
  // Roster configuration (database defaults)
  total_slots: 8,
  draft_slots: 5,
  drop_limit: 2,
  counterbid_hours: 24,
  // Counterpick configuration (database defaults)
  draft_counterpick_slots: 1,
  bidding_counterpick_slots: 0,
  counterpicks_block_drops: true,
}

export default function CreateLeagueModal({ isOpen, onClose, onSuccess }: Props): React.ReactElement | null {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Ensure draft_slots doesn't exceed total_slots
  useEffect(() => {
    if (formData.draft_slots > formData.total_slots) {
      setFormData(prev => ({ ...prev, draft_slots: prev.total_slots }))
    }
  }, [formData.total_slots, formData.draft_slots])

  if (!isOpen) return null

  const pickupSlots = formData.total_slots - formData.draft_slots

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
          // Roster configuration
          total_slots: formData.total_slots,
          draft_slots: formData.draft_slots,
          drop_limit: formData.drop_limit,
          counterbid_hours: formData.counterbid_hours,
          // Counterpick configuration
          draft_counterpick_slots: formData.draft_counterpick_slots,
          bidding_counterpick_slots: formData.bidding_counterpick_slots,
          counterpicks_block_drops: formData.counterpicks_block_drops,
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
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div
        className="glass card p-6 w-full max-w-lg animate-slide-up my-auto max-h-[90vh] overflow-y-auto"
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

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-foreground-secondary hover:text-gold transition-colors w-full"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            />
            <span>Draft & Scoring Options</span>
          </button>

          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="space-y-5 pt-2 border-t border-border">
              {/* Roster Configuration */}
              <div>
                <h4 className="text-sm font-medium text-foreground mb-3">Roster Configuration</h4>
                <div className="grid grid-cols-2 gap-4">
                  {/* Total Slots */}
                  <div>
                    <label htmlFor="total-slots" className="block text-xs font-medium text-foreground-secondary mb-1">
                      Total Roster Slots
                    </label>
                    <input
                      type="number"
                      id="total-slots"
                      value={formData.total_slots}
                      onChange={(e) => setFormData({ ...formData, total_slots: parseInt(e.target.value) || MIN_TOTAL_SLOTS })}
                      className="input w-20"
                      min={MIN_TOTAL_SLOTS}
                      max={MAX_TOTAL_SLOTS}
                    />
                    <p className="text-xs text-foreground-muted mt-1">Movies per team</p>
                  </div>

                  {/* Draft Slots */}
                  <div>
                    <label htmlFor="draft-slots" className="block text-xs font-medium text-foreground-secondary mb-1">
                      Draft Slots
                    </label>
                    <input
                      type="number"
                      id="draft-slots"
                      value={formData.draft_slots}
                      onChange={(e) => setFormData({ ...formData, draft_slots: parseInt(e.target.value) || MIN_DRAFT_SLOTS })}
                      className="input w-20"
                      min={MIN_DRAFT_SLOTS}
                      max={formData.total_slots}
                    />
                    <p className="text-xs text-foreground-muted mt-1">= draft rounds</p>
                  </div>

                  {/* Drop Limit */}
                  <div>
                    <label htmlFor="drop-limit" className="block text-xs font-medium text-foreground-secondary mb-1">
                      Drop Limit
                    </label>
                    <input
                      type="number"
                      id="drop-limit"
                      value={formData.drop_limit}
                      onChange={(e) => setFormData({ ...formData, drop_limit: parseInt(e.target.value) || MIN_DROP_LIMIT })}
                      className="input w-20"
                      min={MIN_DROP_LIMIT}
                      max={MAX_DROP_LIMIT}
                    />
                    <p className="text-xs text-foreground-muted mt-1">Max drops/season</p>
                  </div>

                  {/* Counterbid Window */}
                  <div>
                    <label htmlFor="counterbid-hours" className="block text-xs font-medium text-foreground-secondary mb-1">
                      Counterbid Window
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        id="counterbid-hours"
                        value={formData.counterbid_hours}
                        onChange={(e) => setFormData({ ...formData, counterbid_hours: parseInt(e.target.value) || MIN_COUNTERBID_HOURS })}
                        className="input w-16"
                        min={MIN_COUNTERBID_HOURS}
                        max={MAX_COUNTERBID_HOURS}
                      />
                      <span className="text-xs text-foreground-secondary">hrs</span>
                    </div>
                    <p className="text-xs text-foreground-muted mt-1">Time to counter</p>
                  </div>
                </div>

                {/* Pickup Slots Info */}
                <div className="mt-3 p-2 bg-surface-hover rounded border border-border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground-secondary">Pickup Slots</span>
                    <span className="font-medium text-gold">{pickupSlots} slots</span>
                  </div>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {pickupSlots > 0 ? 'Available via bidding after draft' : 'No pickup slots'}
                  </p>
                </div>
              </div>

              {/* Counterpick Configuration */}
              <div>
                <h4 className="text-sm font-medium text-foreground mb-1">Counterpick Configuration</h4>
                <p className="text-xs text-foreground-muted mb-3">
                  Bet against opponent movies to earn points if they underperform
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {/* Draft Counterpick Slots */}
                  <div>
                    <label htmlFor="draft-counterpick-slots" className="block text-xs font-medium text-foreground-secondary mb-1">
                      Draft Counterpicks
                    </label>
                    <input
                      type="number"
                      id="draft-counterpick-slots"
                      value={formData.draft_counterpick_slots}
                      onChange={(e) => setFormData({ ...formData, draft_counterpick_slots: parseInt(e.target.value) || MIN_DRAFT_COUNTERPICK_SLOTS })}
                      className="input w-20"
                      min={MIN_DRAFT_COUNTERPICK_SLOTS}
                      max={MAX_DRAFT_COUNTERPICK_SLOTS}
                    />
                    <p className="text-xs text-foreground-muted mt-1">After draft (0-5)</p>
                  </div>

                  {/* Bidding Counterpick Slots */}
                  <div>
                    <label htmlFor="bidding-counterpick-slots" className="block text-xs font-medium text-foreground-secondary mb-1">
                      Bidding Counterpicks
                    </label>
                    <input
                      type="number"
                      id="bidding-counterpick-slots"
                      value={formData.bidding_counterpick_slots}
                      onChange={(e) => setFormData({ ...formData, bidding_counterpick_slots: parseInt(e.target.value) || MIN_BIDDING_COUNTERPICK_SLOTS })}
                      className="input w-20"
                      min={MIN_BIDDING_COUNTERPICK_SLOTS}
                      max={MAX_BIDDING_COUNTERPICK_SLOTS}
                    />
                    <p className="text-xs text-foreground-muted mt-1">During bidding (0-3)</p>
                  </div>
                </div>

                {/* Block Drops Toggle */}
                <div className="mt-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="counterpicks-block-drops"
                    checked={formData.counterpicks_block_drops}
                    onChange={(e) => setFormData({ ...formData, counterpicks_block_drops: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
                  />
                  <label htmlFor="counterpicks-block-drops" className="cursor-pointer">
                    <span className="text-xs font-medium text-foreground">Block drops on counterpicked movies</span>
                    <p className="text-xs text-foreground-muted">Prevent dropping movies that have been counterpicked</p>
                  </label>
                </div>
              </div>
            </div>
          )}

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
