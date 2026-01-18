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

  async function handleConfirmDelete(): Promise<void> {
    setIsDeleting(true)

    const { data, error } = await callEdgeFunction<DeleteResponse>('update-league', {
      body: {
        action: 'delete_league',
        league_id: league.id,
      },
    })

    setIsDeleting(false)

    if (error) {
      toast.error(error)
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
            <AlertTriangle className="w-5 h-5 text-crimson" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground">
              Danger Zone
            </h2>
            <p className="text-sm text-foreground-muted">
              Irreversible actions
            </p>
          </div>
        </div>

        {isLocked ? (
          <LockedMessage message="League cannot be deleted after the draft has started." />
        ) : (
          <div className="flex items-center justify-between p-4 bg-crimson/5 rounded-lg border border-crimson/20">
            <div>
              <p className="text-sm font-medium text-foreground">Delete League</p>
              <p className="text-xs text-foreground-muted mt-0.5">
                Permanently delete this league and all its data
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="btn bg-crimson hover:bg-crimson-hover text-white"
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
        />
      )}
    </>
  )
}
