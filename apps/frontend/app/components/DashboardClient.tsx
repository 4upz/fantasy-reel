'use client'

import { useState } from 'react'
import Link from 'next/link'
import LeagueManager from './LeagueManager'
import PendingInvitations from './PendingInvitations'
import type { InvitationWithLeague } from '@/types'

interface Props {
  pendingInvitations: InvitationWithLeague[]
}

export default function DashboardClient({ pendingInvitations }: Props): React.ReactElement {
  const [showCreateModal, setShowCreateModal] = useState(false)

  function openModal(): void {
    setShowCreateModal(true)
  }

  function closeModal(): void {
    setShowCreateModal(false)
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">
            Your Leagues
          </h1>
          <p className="text-foreground-secondary mt-2">
            Create or join fantasy movie leagues and start drafting.
          </p>
        </div>
        <button onClick={openModal} className="btn btn-primary shrink-0">
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create League
        </button>
      </div>

      <div className="mb-8">
        <Link
          href="/movies"
          className="card card-interactive inline-flex items-center gap-3 px-5 py-4"
        >
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-muted">
            <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <div>
            <span className="font-display font-semibold text-foreground">Browse Movies</span>
            <p className="text-sm text-foreground-muted">Search and discover upcoming releases</p>
          </div>
          <svg className="w-5 h-5 text-foreground-muted ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      <PendingInvitations initialInvitations={pendingInvitations} />

      <LeagueManager
        showCreateModal={showCreateModal}
        onModalClose={closeModal}
        onCreateClick={openModal}
      />
    </div>
  )
}
