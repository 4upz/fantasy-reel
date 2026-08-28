'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { ButtonSpinner } from '../../components/Icons'

interface Props {
  leagueName: string
  onConfirm: () => Promise<void>
  onCancel: () => void
  loading: boolean
}

/** @design-system Modals */
export default function ConfirmDeleteModal({
  leagueName,
  onConfirm,
  onCancel,
  loading,
}: Props): React.ReactElement {
  const [confirmText, setConfirmText] = useState('')

  const isConfirmed = confirmText === leagueName
  const isDisabled = loading || !isConfirmed

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
              Delete League
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
            This action <span className="text-crimson font-medium">cannot be undone</span>.
            This will permanently delete the league and all associated data including:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-foreground-muted">
            <li>• All participants and teams</li>
            <li>• All draft picks</li>
            <li>• All invitations</li>
          </ul>
        </div>

        {/* Confirmation Input */}
        <div className="mb-6">
          <label
            htmlFor="confirm_delete"
            className="block text-sm text-foreground-secondary mb-2"
          >
            Type <span className="font-mono text-foreground bg-elevated px-1.5 py-0.5 rounded">{leagueName}</span> to confirm
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
          />
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
              'Delete League'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
