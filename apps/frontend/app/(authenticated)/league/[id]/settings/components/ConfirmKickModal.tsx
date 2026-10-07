'use client'

import { useId } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import Modal from '@/app/components/Modal'
import type { ParticipantWithProfile } from '@/types'
import { getParticipantDisplayName } from '@/utils/league'
import { ButtonSpinner } from '../../components/Icons'

interface Props {
  participant: ParticipantWithProfile
  onConfirm: () => Promise<void>
  onCancel: () => void
  loading: boolean
  /** Why the last removal failed. Shown here: a toast would sit behind the dialog, unheard. */
  error?: string | null
}

/** @design-system Modals */
export default function ConfirmKickModal({
  participant,
  onConfirm,
  onCancel,
  loading,
  error = null,
}: Props): React.ReactElement {
  const displayName = getParticipantDisplayName(participant)
  const titleId = useId()
  const questionId = useId()

  return (
    <Modal onClose={onCancel} preventClose={loading} labelledBy={titleId} describedBy={questionId}>
      <div className="glass card p-6 w-full max-w-md animate-slide-up motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-crimson/10">
              <AlertTriangle className="w-5 h-5 text-crimson-text" />
            </div>
            <h2 id={titleId} className="type-panel text-foreground">
              Remove participant
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close remove participant dialog"
            className="p-1 text-foreground-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div id={questionId} className="mb-6">
          <p className="text-foreground-secondary">
            Are you sure you want to remove{' '}
            <span className="text-foreground font-medium">{displayName}</span>{' '}
            from the league?
          </p>
          <p className="type-body-sm text-foreground-secondary mt-2">
            They will need a new invitation to rejoin.
          </p>
        </div>

        {error && (
          <p role="alert" className="type-body-sm text-error mb-4">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          {/* Starts here: the safe answer to a destructive question. */}
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn btn-ghost"
            data-dialog-initial-focus
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
    </Modal>
  )
}
