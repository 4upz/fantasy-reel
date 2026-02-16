'use client'

import { useState } from 'react'
import LeagueManager from './LeagueManager'
import PendingInvitations from './PendingInvitations'
import DashboardSidebar from './DashboardSidebar'
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
      {/* Hero Section */}
      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-3xl sm:text-4xl font-bold font-display text-foreground">
          Your Leagues
        </h1>
        <p className="text-foreground-secondary mt-2 max-w-xl lg:max-w-none">
          Draft upcoming movies, compete with friends, and score points based on reviews.
        </p>
      </div>

      {/* Pending Invitations Banner - Full width at top */}
      {pendingInvitations.length > 0 && (
        <div className="mb-6">
          <PendingInvitations initialInvitations={pendingInvitations} />
        </div>
      )}

      {/* Main Content - Two-column asymmetric layout */}
      <div className="dashboard-grid">
        {/* Main column - Leagues */}
        <div>
          <LeagueManager
            showCreateModal={showCreateModal}
            onModalClose={closeModal}
            onCreateClick={openModal}
          />
        </div>

        {/* Sidebar - Actions and Stats */}
        <div>
          <DashboardSidebar onCreateClick={openModal} />
        </div>
      </div>
    </div>
  )
}
