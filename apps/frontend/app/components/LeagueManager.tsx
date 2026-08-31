'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { League } from '@/types'
import { groupLeaguesIntoSeries } from '@/utils/seasons'
import SeriesListItem from './SeriesListItem'

const CreateLeagueModal = dynamic(() => import('./CreateLeagueModal'))

function preloadCreateLeagueModal(): void {
  void import('./CreateLeagueModal')
}

interface Props {
  /** Every season of every league the user is in, newest first. */
  leagues: League[]
  loading: boolean
  showCreateModal: boolean
  onModalClose: () => void
  onCreateClick: () => void
  onLeagueCreated: (league: League) => void
}

export default function LeagueManager({
  leagues,
  loading,
  showCreateModal,
  onModalClose,
  onCreateClick,
  onLeagueCreated,
}: Props): React.ReactElement {
  // A league with four years of history is one entry, not four.
  const series = useMemo(() => groupLeaguesIntoSeries(leagues), [leagues])

  // Loading state - skeleton
  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
        {[1, 2].map((i) => (
          <div key={i} className="card p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="skeleton h-5 w-48 rounded" />
                  <div className="skeleton h-5 w-16 rounded-full" />
                </div>
                <div className="skeleton h-4 w-64 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Empty state
  if (series.length === 0) {
    return (
      <>
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-surface mb-6">
            <svg className="w-12 h-12 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h3 className="font-display text-2xl text-foreground mb-3">Start your cinematic journey</h3>
          <p className="text-foreground-muted mb-8 max-w-md mx-auto">
            Create your first fantasy movie league and invite friends to compete. Draft upcoming releases and score points based on reviews.
          </p>
          <button
            onClick={onCreateClick}
            className="btn btn-primary text-lg px-6 py-3"
            data-testid="create-league-button"
            onMouseEnter={preloadCreateLeagueModal}
            onFocus={preloadCreateLeagueModal}
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Your First League
          </button>
        </div>

        <CreateLeagueModal
          isOpen={showCreateModal}
          onClose={onModalClose}
          onSuccess={onLeagueCreated}
        />
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {series.map((seasons) => (
          <SeriesListItem key={seasons[0].series_id} seasons={seasons} />
        ))}
      </div>

      <CreateLeagueModal
        isOpen={showCreateModal}
        onClose={onModalClose}
        onSuccess={onLeagueCreated}
      />
    </>
  )
}
