'use client'

import { X, AlertTriangle } from 'lucide-react'
import type { ParticipantWithProfile } from '@/types'
import { getParticipantDisplayName } from '@/utils/league'
import { ButtonSpinner } from '../../components/Icons'

interface Props {
  participant: ParticipantWithProfile
  onConfirm: () => Promise<void>
  onCancel: () => void
  loading: boolean
}

export default function ConfirmKickModal({
  participant,
  onConfirm,
  onCancel,
  loading,
}: Props): React.ReactElement {
  const displayName = getParticipantDisplayName(participant)

  return (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
      <div className="glass card p-6 w-full max-w-md animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-crimson/10">
              <AlertTriangle className="w-5 h-5 text-crimson" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">
              Remove Participant
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-foreground-secondary">
            Are you sure you want to remove{' '}
            <span className="text-foreground font-medium">{displayName}</span>{' '}
            from the league?
          </p>
          <p className="text-sm text-foreground-muted mt-2">
            They will need a new invitation to rejoin.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="btn bg-crimson hover:bg-crimson-hover text-white"
          >
            {loading ? (
              <>
                <ButtonSpinner variant="danger" />
                Removing...
              </>
            ) : (
              'Remove'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
