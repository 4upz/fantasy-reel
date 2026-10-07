'use client'

import { useId } from 'react'
import { X } from 'lucide-react'
import Modal from '@/app/components/Modal'
import { ButtonSpinner } from './Icons'

interface Props {
  /** The year about to be created. */
  seasonYear: number
  /** The year being carried over from. */
  previousSeasonYear: number
  /** Everyone who comes along, by display name. */
  participantNames: string[]
  isLoading: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirms a rollover into the next season.
 *
 * A confirm step is here because this action copies *people*: everyone in the
 * league is moved into a season they did not ask for. Listing them by name is
 * the point - it is the only chance the owner has to notice they are carrying
 * over someone who left, and the only place a member's exit is mentioned
 * before it becomes their problem.
 */
/** @design-system Modals */
export default function ConfirmStartSeasonModal({
  seasonYear,
  previousSeasonYear,
  participantNames,
  isLoading,
  error = null,
  onConfirm,
  onCancel,
}: Props): React.ReactElement {
  const titleId = useId()

  // Escape closes, but never mid-request: the next season is already being
  // created and the redirect still has to land.
  return (
    <Modal onClose={onCancel} preventClose={isLoading} labelledBy={titleId}>
      <div className="glass card modal-panel max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-md animate-slide-up motion-reduce:animate-none p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="type-meta text-foreground-secondary">
              {seasonYear} season
            </p>
            <h2
              id={titleId}
              className="mt-1 type-panel text-foreground"
            >
              Start the {seasonYear} season?
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Close start season dialog"
            className="cursor-pointer p-1 text-foreground-secondary transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-foreground-secondary">
          Everyone from {previousSeasonYear} comes along with their team name. Rosters start empty,
          and anyone can leave from the new season&apos;s page.
        </p>

        {participantNames.length > 0 && (
          <div className="mt-4 rounded-lg border border-border bg-elevated p-3">
            <p className="mb-2 type-label text-foreground-secondary">
              Carrying over ({participantNames.length})
            </p>
            <ul className="space-y-1 text-sm text-foreground-secondary" role="list">
              {participantNames.map((name, index) => (
                <li key={`${index}-${name}`} className="break-words">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={isLoading} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="btn btn-primary"
            data-testid="confirm-start-season"
          >
            {isLoading ? (
              <>
                <ButtonSpinner />
                Creating...
              </>
            ) : (
              `Start ${seasonYear}`
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
