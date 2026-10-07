'use client'

import { useState, useCallback, useEffect, useId, useRef } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { createClient } from '@/utils/supabase/client'
import Modal from '@/app/components/Modal'

const CONFIRMATION = 'DELETE'

interface Props {
  onClose: () => void
}

class ReauthRequiredError extends Error {}

/** @design-system Modals */
export default function DeleteAccountModal({ onClose }: Props): React.ReactElement {
  const [confirmation, setConfirmation] = useState('')
  const [needsReauth, setNeedsReauth] = useState(false)
  const titleId = useId()
  const confirmationHintId = useId()
  const warningId = useId()
  const signInAgainRef = useRef<HTMLButtonElement>(null)

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

  // The form, and the button that had focus, are replaced by the sign-in
  // prompt; its alert is read and focus lands on the action it asks for.
  useEffect(() => {
    if (needsReauth) signInAgainRef.current?.focus()
  }, [needsReauth])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    try {
      await execute()
    } catch (err) {
      if (err instanceof ReauthRequiredError) setNeedsReauth(true)
    }
  }

  return (
    <Modal onClose={onClose} preventClose={isLoading} labelledBy={titleId} describedBy={needsReauth ? undefined : warningId}>
      <div className="glass card p-6 w-full max-w-md animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-error-bg">
              <AlertTriangle className="w-5 h-5 text-crimson-text" aria-hidden="true" />
            </div>
            <h2 id={titleId} className="type-panel text-foreground">
              Delete account
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close delete account"
            className="p-1 cursor-pointer text-foreground-secondary hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {needsReauth ? (
          <>
            <div role="alert" className="alert alert-warning mb-6">
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
                <input type="hidden" name="next" value="/settings" />
                <button ref={signInAgainRef} type="submit" className="btn btn-primary">
                  Sign in again
                </button>
              </form>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="type-body-sm text-foreground-secondary space-y-3 mb-6">
              <p id={warningId}>This permanently deletes your account, profile and photo. It can&apos;t be undone.</p>
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

            {/* Toasts are hidden behind an open dialog, so errors render here. */}
            {error && (
              <div role="alert" className="alert alert-error mb-4">
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
                aria-describedby={confirmationHintId}
                data-dialog-initial-focus
              />
              <p id={confirmationHintId} className="sr-only">
                The Delete account button stays unavailable until you type {CONFIRMATION} exactly.
              </p>
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
                    <span className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin mr-2" aria-hidden="true" />
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
    </Modal>
  )
}
