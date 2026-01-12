'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { League, ParticipantWithTeam, DraftPickWithDetails } from '@/types'
import type { RealtimeStatus } from './components/ConnectionStatusIndicator'
import DraftBoard from './components/DraftBoard'
import InvitationsList from './components/InvitationsList'
import InviteModal from './components/InviteModal'
import LeagueHeader from './components/LeagueHeader'
import ParticipantsList from './components/ParticipantsList'

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 2000

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  currentUserId: string
  isOwner: boolean
}

export default function LeagueDetailClient({
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
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting')

  // Local favorites state (tracks tmdb_ids as numbers)
  const [favoriteMovieIds, setFavoriteMovieIds] = useState<Set<number>>(() => {
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

  // Stable Supabase client reference to prevent new instance on every render
  const supabase = useMemo(() => createClient(), [])

  // Reconnection tracking
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const channelIdRef = useRef(0) // Unique ID for each channel to avoid name conflicts

  // Persist favorites to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        `draft-favorites-${league.id}`,
        JSON.stringify([...favoriteMovieIds])
      )
    }
  }, [favoriteMovieIds, league.id])

  // Memoized fetch functions for stable references in subscriptions
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

  // Set up real-time subscriptions for draft updates with auto-reconnect
  useEffect(() => {
    let currentChannel: ReturnType<typeof supabase.channel> | null = null
    let isCleaningUp = false

    function setupChannel(): void {
      if (isCleaningUp) return

      // Clean up previous channel before creating new one
      if (currentChannel) {
        supabase.removeChannel(currentChannel)
        currentChannel = null
      }

      const isReconnect = reconnectAttemptsRef.current > 0
      setRealtimeStatus(isReconnect ? 'reconnecting' : 'connecting')

      // Increment channel ID to create unique name and track current channel
      channelIdRef.current++
      const thisChannelId = channelIdRef.current

      const channel = supabase
        .channel(`league-${league.id}-${thisChannelId}`)
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
        .subscribe((status, err) => {
          // Ignore events from stale channels or during cleanup
          if (isCleaningUp || thisChannelId !== channelIdRef.current) return

          if (status === 'SUBSCRIBED') {
            console.log(`Realtime: Connected to league-${league.id}`)
            reconnectAttemptsRef.current = 0
            setRealtimeStatus('connected')
            return
          }

          // Handle connection errors (CHANNEL_ERROR or TIMED_OUT)
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const errorMsg = status === 'CHANNEL_ERROR' ? 'Channel error' : 'Connection timed out'
            console.warn(`Realtime: ${errorMsg}, will attempt reconnect`, err)

            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttemptsRef.current++
              setRealtimeStatus('reconnecting')
              console.log(
                `Realtime: Reconnecting (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`
              )
              reconnectTimeoutRef.current = setTimeout(setupChannel, RECONNECT_DELAY_MS)
            } else {
              console.error('Realtime: Max reconnection attempts reached')
              setRealtimeStatus('error')
            }
          }
          // Ignore CLOSED events - they follow ERROR/TIMEOUT which already handle reconnection
        })

      currentChannel = channel
    }

    setupChannel()

    return () => {
      isCleaningUp = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (currentChannel) {
        supabase.removeChannel(currentChannel)
      }
      reconnectAttemptsRef.current = 0
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <LeagueHeader
          league={league}
          isOwner={isOwner}
          participantCount={participants.length}
          realtimeStatus={realtimeStatus}
          onInviteClick={() => setShowInviteModal(true)}
        />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
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
