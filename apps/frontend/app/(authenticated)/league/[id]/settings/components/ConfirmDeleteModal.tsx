'use client'

import { useId, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import Modal from '@/app/components/Modal'
import { ButtonSpinner } from '../../components/Icons'

interface Props {
  leagueName: string
  onConfirm: () => Promise<void>
  onCancel: () => void
  loading: boolean
  /** Why the last delete failed. Shown here: a toast would sit behind the dialog, unheard. */
  error?: string | null
}

/** @design-system Modals */
export default function ConfirmDeleteModal({
  leagueName,
  onConfirm,
  onCancel,
  loading,
  error = null,
}: Props): React.ReactElement {
  const [confirmText, setConfirmText] = useState('')
  const titleId = useId()
  const warningId = useId()
  const hintId = useId()

  const isConfirmed = confirmText === leagueName
  const isDisabled = loading || !isConfirmed

  return (
    <Modal onClose={onCancel} preventClose={loading} labelledBy={titleId} describedBy={warningId}>
      <div className="glass card p-6 w-full max-w-md animate-slide-up motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-crimson/10">
              <AlertTriangle className="w-5 h-5 text-crimson-text" />
            </div>
            <h2 id={titleId} className="type-panel text-foreground">
              Delete league
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close delete league dialog"
            className="p-1 text-foreground-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div id={warningId} className="mb-6">
          <p className="text-foreground-secondary">
            This action <span className="text-crimson-text font-medium">cannot be undone</span>.
            This will permanently delete the league and all associated data including:
          </p>
          <ul role="list" className="type-body-sm mt-3 space-y-1 text-foreground-secondary">
            <li><span aria-hidden="true">• </span>All participants and teams</li>
            <li><span aria-hidden="true">• </span>All draft picks</li>
            <li><span aria-hidden="true">• </span>All invitations</li>
          </ul>
        </div>

        {/* Confirmation Input */}
        <div className="mb-6">
          <label
            htmlFor="confirm_delete"
            className="type-label block text-foreground-secondary mb-2"
          >
            Type <span className="type-row-title text-foreground bg-elevated px-1.5 py-0.5 rounded">{leagueName}</span> to confirm
          </label>
          <input
            type="text"
            id="confirm_delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Enter league name"
            className="input"
            autoComplete="off"
            disabled={loading}
            aria-describedby={hintId}
            data-dialog-initial-focus
          />
          {/* Why Delete stays disabled while the text is close but not exact. */}
          <p id={hintId} className="sr-only">
            Must match the league name exactly, including capital letters.
          </p>
          {error && (
            <p role="alert" className="type-body-sm text-error mt-2">
              {error}
            </p>
          )}
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
            disabled={isDisabled}
            className="btn bg-crimson hover:bg-crimson-hover text-white disabled:opacity-50"
          >
            {loading ? (
              <>
                <ButtonSpinner variant="danger" />
                Deleting...
              </>
            ) : (
              'Delete league'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
