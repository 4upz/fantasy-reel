'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League, ParticipantWithTeam, DraftPickWithDetails } from '@/types'
import DraftBoard from '../components/DraftBoard'
import InvitationsList from '../components/InvitationsList'
import InviteModal from '../components/InviteModal'
import ParticipantsList from '../components/ParticipantsList'

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 2000

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  currentUserId: string
  isOwner: boolean
}

export default function DraftClient({
  league: initialLeague,
  participants: initialParticipants,
  draftPicks: initialDraftPicks,
  currentUserId,
  isOwner,
}: Props) {
  const [league, setLeague] = useState(initialLeague)
  const [participants, setParticipants] = useState(initialParticipants)
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [startingDraft, setStartingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local favorites state
  const [favoriteMovieIds, setFavoriteMovieIds] = useState<Set<number>>(() => {
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

  const supabase = useMemo(() => createClient(), [])
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const channelIdRef = useRef(0)

  // Persist favorites
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        `draft-favorites-${league.id}`,
        JSON.stringify([...favoriteMovieIds])
      )
    }
  }, [favoriteMovieIds, league.id])

  const fetchDraftPicks = useCallback(async () => {
    const { data } = await supabase
      .from('draft_picks')
      .select(`*, movies (*), teams (*)`)
      .eq('league_id', league.id)
      .order('round', { ascending: true })
      .order('pick_number', { ascending: true })

    if (data) {
      setDraftPicks(data as DraftPickWithDetails[])
    }
  }, [supabase, league.id])

  const fetchParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', league.id)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    if (data) {
      setParticipants(data as ParticipantWithTeam[])
    }
  }, [supabase, league.id])

  // Real-time subscriptions
  useEffect(() => {
    let currentChannel: ReturnType<typeof supabase.channel> | null = null
    let isCleaningUp = false

    function setupChannel(): void {
      if (isCleaningUp) return

      if (currentChannel) {
        supabase.removeChannel(currentChannel)
        currentChannel = null
      }

      channelIdRef.current++
      const thisChannelId = channelIdRef.current

      const channel = supabase
        .channel(`draft-${league.id}-${thisChannelId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'draft_picks',
            filter: `league_id=eq.${league.id}`,
          },
          fetchDraftPicks
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'leagues',
            filter: `id=eq.${league.id}`,
          },
          (payload) => setLeague(payload.new as League)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'league_participants',
            filter: `league_id=eq.${league.id}`,
          },
          fetchParticipants
        )
        .subscribe((status) => {
          if (isCleaningUp || thisChannelId !== channelIdRef.current) return

          if (status === 'SUBSCRIBED') {
            reconnectAttemptsRef.current = 0
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttemptsRef.current++
              reconnectTimeoutRef.current = setTimeout(setupChannel, RECONNECT_DELAY_MS)
            }
          }
        })

      currentChannel = channel
    }

    setupChannel()

    return () => {
      isCleaningUp = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (currentChannel) {
        supabase.removeChannel(currentChannel)
      }
    }
  }, [league.id, supabase, fetchDraftPicks, fetchParticipants])

  const handlePickMade = useCallback(() => {
    fetchDraftPicks()
  }, [fetchDraftPicks])

  const handleToggleFavorite = useCallback((tmdbId: number) => {
    setFavoriteMovieIds((prev) => {
      const next = new Set(prev)
      if (next.has(tmdbId)) {
        next.delete(tmdbId)
      } else {
        next.add(tmdbId)
      }
      return next
    })
  }, [])

  async function handleStartDraft(): Promise<void> {
    if (participants.length < 2) {
      setError('Need at least 2 participants to start the draft')
      return
    }

    setStartingDraft(true)
    setError(null)

    const { error: startError } = await callEdgeFunction('start-draft', {
      body: { league_id: league.id },
    })

    if (startError) {
      setError(startError)
    }

    setStartingDraft(false)
  }

  return (
    <>
      {/* Owner Controls for Setup */}
      {isOwner && league.status === 'setup' && (
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => setShowInviteModal(true)} className="btn btn-secondary">
            Invite Players
          </button>
          <button
            onClick={handleStartDraft}
            disabled={startingDraft || participants.length < 2}
            className="btn btn-primary"
          >
            {startingDraft ? 'Starting...' : 'Start Draft'}
          </button>
          {error && <span className="text-sm text-error">{error}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DraftBoard
            league={league}
            participants={participants}
            draftPicks={draftPicks}
            currentUserId={currentUserId}
            favoriteMovieIds={favoriteMovieIds}
            onPickMade={handlePickMade}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>

        <div className="space-y-6">
          <ParticipantsList participants={participants} ownerId={league.owner_id} />
          {league.status === 'setup' && (
            <InvitationsList
              leagueId={league.id}
              isOwner={isOwner}
              leagueStatus={league.status}
            />
          )}
        </div>
      </div>

      {showInviteModal && (
        <InviteModal leagueId={league.id} onClose={() => setShowInviteModal(false)} />
      )}
    </>
  )
}
