'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import { LockedMessage } from './shared'
import ConfirmDeleteModal from './ConfirmDeleteModal'

interface Props {
  league: League
  isLocked: boolean
  onDelete: () => void
}

interface DeleteResponse {
  message: string
}

export default function DangerZoneSection({
  league,
  isLocked,
  onDelete,
}: Props): React.ReactElement {
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleConfirmDelete(): Promise<void> {
    setIsDeleting(true)
    setDeleteError(null)

    const { data, error } = await callEdgeFunction<DeleteResponse>('update-league', {
      body: {
        action: 'delete_league',
        league_id: league.id,
      },
    })

    setIsDeleting(false)

    if (error) {
      // In the dialog, not a toast: the open dialog leaves a toast unseen and unheard.
      setDeleteError(error)
      return
    }

    if (data?.message) {
      toast.success(data.message)
      onDelete()
    }
  }

  return (
    <>
      <section className="card p-6 border-crimson/30">
        {/* Custom header for danger zone with crimson styling */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-crimson/20">
          <div className="p-2 rounded-lg bg-crimson/10">
            <AlertTriangle className="w-5 h-5 text-crimson-text" />
          </div>
          <div>
            <h3 className="type-section text-foreground">
              Danger zone
            </h3>
            <p className="type-body-sm text-foreground-secondary">
              Irreversible actions
            </p>
          </div>
        </div>

        {isLocked ? (
          <LockedMessage message="League cannot be deleted after the draft has started." />
        ) : (
          <div className="flex items-center justify-between p-4 bg-crimson/5 rounded-lg border border-crimson/20">
            <div>
              <p className="type-label text-foreground">Delete league</p>
              <p className="type-meta text-foreground-secondary mt-0.5">
                Permanently delete this league and all its data
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDeleteError(null)
                setShowDeleteModal(true)
              }}
              className="btn bg-crimson hover:bg-crimson-hover text-white"
              aria-label="Delete league"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </button>
          </div>
        )}
      </section>

      {showDeleteModal && (
        <ConfirmDeleteModal
          leagueName={league.name}
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowDeleteModal(false)}
          loading={isDeleting}
          error={deleteError}
        />
      )}
    </>
  )
}
