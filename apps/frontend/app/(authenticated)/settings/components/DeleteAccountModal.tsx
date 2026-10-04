'use client'

import { useState, useCallback } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { createClient } from '@/utils/supabase/client'

const CONFIRMATION = 'DELETE'

interface Props {
  onClose: () => void
}

class ReauthRequiredError extends Error {}

/** @design-system Modals */
export default function DeleteAccountModal({ onClose }: Props): React.ReactElement {
  const [confirmation, setConfirmation] = useState('')
  const [needsReauth, setNeedsReauth] = useState(false)

  const deleteAccount = useCallback(async () => {
    const { error, errorBody } = await callEdgeFunction<{ deleted: boolean }>('delete-account', {
      body: { confirmation: CONFIRMATION },
    })
    if (errorBody?.code === 'reauth_required') {
      throw new ReauthRequiredError(error ?? 'Sign in again to delete your account')
    }
    if (error) throw new Error(error)

    // The account is gone, so the server-side sign-out has no session to end.
    // Clearing the local session is all that is left.
    await createClient().auth.signOut({ scope: 'local' })
    window.location.assign('/')
  }, [])

  const { execute, isLoading, error } = useAsyncAction(deleteAccount)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    try {
      await execute()
    } catch (err) {
      if (err instanceof ReauthRequiredError) setNeedsReauth(true)
    }
  }

  return (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-heading"
        className="glass card p-6 w-full max-w-md animate-slide-up"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-error-bg">
              <AlertTriangle className="w-5 h-5 text-crimson" aria-hidden="true" />
            </div>
            <h2 id="delete-account-heading" className="type-panel text-foreground">
              Delete account
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
            className="p-1 text-foreground-secondary hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {needsReauth ? (
          <>
            <div className="alert alert-warning mb-6">
              <p>
                For your security, deleting your account needs a recent sign-in. Sign in again,
                then come back to Settings to finish.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                Cancel
              </button>
              <form action="/auth/signout" method="post">
                <button type="submit" className="btn btn-primary">
                  Sign in again
                </button>
              </form>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="type-body-sm text-foreground-secondary space-y-3 mb-6">
              <p>This permanently deletes your account, profile and photo. It can&apos;t be undone.</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Leagues you run pass to their longest-standing member. A league nobody else has joined is deleted.</li>
                <li>You&apos;re removed from leagues that haven&apos;t drafted yet.</li>
                <li>
                  In active and finished seasons your team and roster stay, shown as &ldquo;Former
                  member&rdquo;, so trades and counterpicks involving it still hold. A season in
                  progress stops ranking your team; finished seasons keep their results.
                </li>
                <li>Your pending bids and trade offers are cancelled.
                </li>
              </ul>
              <p>If you&apos;re in a draft that&apos;s underway, finish it first.</p>
            </div>

            {error && (
              <div className="alert alert-error mb-4">
                <p>{error}</p>
              </div>
            )}

            <div className="mb-6">
              <label htmlFor="deleteConfirmation" className="type-label block text-foreground-secondary mb-2">
                Type {CONFIRMATION} to confirm
              </label>
              <input
                type="text"
                id="deleteConfirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className="input"
                autoComplete="off"
                spellCheck={false}
                disabled={isLoading}
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={onClose} disabled={isLoading} className="btn btn-ghost">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || confirmation !== CONFIRMATION}
                className="btn btn-danger"
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  'Delete account'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
