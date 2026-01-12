'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import LeagueHeader from './components/LeagueHeader'
import ParticipantsList from './components/ParticipantsList'
import DraftBoard from './components/DraftBoard'
import InviteModal from './components/InviteModal'
import InvitationsList from './components/InvitationsList'
import type { League, ParticipantWithTeam, DraftPickWithDetails, Movie } from '@/types'

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  availableMovies: Movie[]
  currentUserId: string
  isOwner: boolean
}

export default function LeagueDetailClient({
  league: initialLeague,
  participants: initialParticipants,
  draftPicks: initialDraftPicks,
  availableMovies: initialMovies,
  currentUserId,
  isOwner,
}: Props) {
  const [league, setLeague] = useState(initialLeague)
  const [participants, setParticipants] = useState(initialParticipants)
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [availableMovies, setAvailableMovies] = useState(initialMovies)
  const [showInviteModal, setShowInviteModal] = useState(false)

  // Local favorites state (will be replaced with DB-backed state in Phase 2)
  const [favoriteMovieIds, setFavoriteMovieIds] = useState<Set<string>>(() => {
    // Try to restore from localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`draft-favorites-${initialLeague.id}`)
      if (stored) {
        try {
          return new Set(JSON.parse(stored))
        } catch {
          return new Set()
        }
      }
    }
    return new Set()
  })

  const supabase = createClient()

  // Persist favorites to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        `draft-favorites-${league.id}`,
        JSON.stringify([...favoriteMovieIds])
      )
    }
  }, [favoriteMovieIds, league.id])

  // Set up real-time subscriptions for draft updates
  useEffect(() => {
    const channel = supabase
      .channel(`league-${league.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_picks',
          filter: `league_id=eq.${league.id}`,
        },
        () => {
          // Refetch draft picks when new pick is made
          fetchDraftPicks()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leagues',
          filter: `id=eq.${league.id}`,
        },
        (payload) => {
          setLeague(payload.new as League)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'league_participants',
          filter: `league_id=eq.${league.id}`,
        },
        () => {
          // Refetch participants when someone joins
          fetchParticipants()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.id])

  const fetchDraftPicks = async () => {
    const { data } = await supabase
      .from('draft_picks')
      .select(`*, movies (*), teams (*)`)
      .eq('league_id', league.id)
      .order('round', { ascending: true })
      .order('pick_number', { ascending: true })

    if (data) {
      setDraftPicks(data as DraftPickWithDetails[])
      // Update available movies by filtering out drafted ones
      const draftedMovieIds = new Set(data.map((dp) => dp.movie_id))
      setAvailableMovies((prev) => prev.filter((m) => !draftedMovieIds.has(m.id)))
    }
  }

  const fetchParticipants = async () => {
    const { data } = await supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', league.id)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    if (data) {
      setParticipants(data as ParticipantWithTeam[])
    }
  }

  const handlePickMade = () => {
    fetchDraftPicks()
  }

  const handleToggleFavorite = useCallback((movieId: string) => {
    setFavoriteMovieIds((prev) => {
      const next = new Set(prev)
      if (next.has(movieId)) {
        next.delete(movieId)
      } else {
        next.add(movieId)
      }
      return next
    })
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <LeagueHeader
          league={league}
          isOwner={isOwner}
          participantCount={participants.length}
          onInviteClick={() => setShowInviteModal(true)}
        />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <DraftBoard
              league={league}
              participants={participants}
              draftPicks={draftPicks}
              availableMovies={availableMovies}
              currentUserId={currentUserId}
              favoriteMovieIds={favoriteMovieIds}
              onPickMade={handlePickMade}
              onToggleFavorite={handleToggleFavorite}
            />
          </div>

          <div>
            <ParticipantsList participants={participants} ownerId={league.owner_id} />
            <InvitationsList
              leagueId={league.id}
              isOwner={isOwner}
              leagueStatus={league.status}
            />
          </div>
        </div>

        {showInviteModal && (
          <InviteModal leagueId={league.id} onClose={() => setShowInviteModal(false)} />
        )}
      </div>
    </div>
  )
}
