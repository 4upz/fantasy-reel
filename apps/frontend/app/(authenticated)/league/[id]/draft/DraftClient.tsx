'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League, ParticipantWithTeam, DraftPickWithDetails, CounterpickWithDetails } from '@/types'
import DraftBoard from '../components/DraftBoard'
import InvitationsList from '../components/InvitationsList'
import ParticipantsList from '../components/ParticipantsList'
import { SpinnerIcon } from '../components/Icons'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const InviteModal = dynamic(() => import('../components/InviteModal'), {
  loading: () => <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4"><div className="animate-pulse h-64 w-full max-w-md bg-surface rounded-lg" /></div>,
})

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 2000

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  counterpicks: CounterpickWithDetails[]
  currentUserId: string
  isOwner: boolean
}

export default function DraftClient({
  league: initialLeague,
  participants: initialParticipants,
  draftPicks: initialDraftPicks,
  counterpicks: initialCounterpicks,
  currentUserId,
  isOwner,
}: Props) {
  const [league, setLeague] = useState(initialLeague)
  const [participants, setParticipants] = useState(initialParticipants)
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [counterpicks, setCounterpicks] = useState(initialCounterpicks)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [startingDraft, setStartingDraft] = useState(false)
  const [startingCounterpick, setStartingCounterpick] = useState(false)
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

  const fetchCounterpicks = useCallback(async () => {
    const { data } = await supabase
      .from('counterpicks')
      .select('*, movies (*)')
      .eq('league_id', league.id)
      .order('pick_order', { ascending: true })

    if (data) {
      setCounterpicks(data as CounterpickWithDetails[])
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
            event: '*',
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
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'counterpicks',
            filter: `league_id=eq.${league.id}`,
          },
          fetchCounterpicks
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
  }, [league.id, supabase, fetchDraftPicks, fetchParticipants, fetchCounterpicks])

  const handlePickMade = useCallback(() => {
    fetchDraftPicks()
  }, [fetchDraftPicks])

  const handleCounterpickMade = useCallback(() => {
    fetchCounterpicks()
    fetchDraftPicks() // Also refetch draft picks to get updated counterpicked_by_team_id
  }, [fetchCounterpicks, fetchDraftPicks])

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

  // Check if draft is complete (all picks made)
  const totalPicks = participants.length * league.draft_slots
  const isDraftComplete = league.status === 'drafting' && draftPicks.length >= totalPicks
  const canStartCounterpick =
    isOwner &&
    isDraftComplete &&
    league.draft_counterpick_slots > 0

  async function handleStartCounterpickRound(): Promise<void> {
    setStartingCounterpick(true)
    setError(null)

    const { error: startError } = await callEdgeFunction('start-counterpick-round', {
      body: { league_id: league.id },
    })

    if (startError) {
      setError(startError)
    }

    setStartingCounterpick(false)
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

      {/* Owner Controls for Starting Counterpick Round */}
      {canStartCounterpick && (
        <div className="mb-6">
          <div className="card p-4 bg-crimson/10 border-crimson/30">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-crimson/20 rounded-full flex items-center justify-center">
                  <Target className="w-5 h-5 text-crimson" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Draft Complete!</p>
                  <p className="text-sm text-foreground-muted">
                    Ready to start the counterpick round ({league.draft_counterpick_slots} pick{league.draft_counterpick_slots !== 1 ? 's' : ''} per team)
                  </p>
                </div>
              </div>
              <button
                onClick={handleStartCounterpickRound}
                disabled={startingCounterpick}
                className="btn btn-primary flex items-center gap-2"
              >
                {startingCounterpick ? (
                  <>
                    <SpinnerIcon className="w-4 h-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Target className="w-4 h-4" />
                    Start Counterpick Round
                  </>
                )}
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-error">{error}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DraftBoard
            league={league}
            participants={participants}
            draftPicks={draftPicks}
            counterpicks={counterpicks}
            currentUserId={currentUserId}
            favoriteMovieIds={favoriteMovieIds}
            onPickMade={handlePickMade}
            onCounterpickMade={handleCounterpickMade}
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
