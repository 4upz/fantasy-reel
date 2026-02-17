'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League, ParticipantWithProfile, DraftPickWithDetails, CounterpickWithDetails } from '@/types'
import DraftBoard, { PickHistory } from '../components/DraftBoard'
import ConnectionStatusIndicator, { type RealtimeStatus } from '../components/ConnectionStatusIndicator'
import { buildTeamInfoByTeamId } from '@/utils/league'
import InvitationsList from '../components/InvitationsList'
import JoinLinkCard from '../components/JoinLinkCard'
import ParticipantsList from '../components/ParticipantsList'
import { SpinnerIcon } from '../components/Icons'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const InviteModal = dynamic(() => import('../components/InviteModal'), {
  loading: () => <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4"><div className="animate-pulse h-64 w-full max-w-md bg-surface rounded-lg" /></div>,
})

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_DELAY_MS = 2000
const POLL_INTERVAL_MS = 10_000

interface Props {
  league: League
  participants: ParticipantWithProfile[]
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
}: Props): React.ReactElement {
  const [league, setLeague] = useState(initialLeague)
  const [participants, setParticipants] = useState(initialParticipants)
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [counterpicks, setCounterpicks] = useState(initialCounterpicks)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [startingDraft, setStartingDraft] = useState(false)
  const [startingCounterpick, setStartingCounterpick] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting')
  const [pickHistoryExpanded, setPickHistoryExpanded] = useState(false)

  const teamInfoById = useMemo(() => buildTeamInfoByTeamId(participants), [participants])
  const supabase = useMemo(() => createClient(), [])
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const channelIdRef = useRef(0)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Wraps a Supabase query with consistent error handling and state update.
   * Returns false on failure so callers can react to fetch outcomes.
   */
  const safeFetch = useCallback(
    async <T,>(
      label: string,
      query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
      onSuccess: (data: T) => void,
    ): Promise<boolean> => {
      try {
        const { data, error } = await query
        if (error) {
          console.warn(`[DraftClient] Failed to fetch ${label}:`, error.message)
          return false
        }
        if (data) onSuccess(data)
        return true
      } catch (err) {
        console.warn(`[DraftClient] Error fetching ${label}:`, err)
        return false
      }
    },
    [],
  )

  // Explicit FK required: draft_picks has two FKs to teams (team_id, counterpicked_by_team_id)
  // Without explicit FK, PostgREST returns PGRST201 ambiguous relationship error
  const fetchDraftPicks = useCallback(
    () =>
      safeFetch(
        'draft picks',
        supabase
          .from('draft_picks')
          .select(`*, movies (*), teams!draft_picks_team_id_fkey (*)`)
          .eq('league_id', league.id)
          .order('round', { ascending: true })
          .order('pick_number', { ascending: true }),
        (data) => setDraftPicks(data as DraftPickWithDetails[]),
      ),
    [safeFetch, supabase, league.id],
  )

  const fetchParticipants = useCallback(
    () =>
      safeFetch(
        'participants',
        supabase
          .from('league_participants')
          .select(`*, teams (*), profiles (*)`)
          .eq('league_id', league.id)
          .eq('status', 'active')
          .order('draft_order', { ascending: true }),
        (data) => setParticipants(data as ParticipantWithProfile[]),
      ),
    [safeFetch, supabase, league.id],
  )

  const fetchCounterpicks = useCallback(
    () =>
      safeFetch(
        'counterpicks',
        supabase
          .from('counterpicks')
          .select('*, movies (*)')
          .eq('league_id', league.id)
          .order('pick_order', { ascending: true }),
        (data) => setCounterpicks(data as CounterpickWithDetails[]),
      ),
    [safeFetch, supabase, league.id],
  )

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return
    pollingIntervalRef.current = setInterval(() => {
      fetchDraftPicks()
      fetchCounterpicks()
    }, POLL_INTERVAL_MS)
  }, [fetchDraftPicks, fetchCounterpicks])

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }, [])

  // Real-time subscriptions
  useEffect(() => {
    let currentChannel: ReturnType<typeof supabase.channel> | null = null
    let isCleaningUp = false

    function setupChannel(isReconnect = false): void {
      if (isCleaningUp) return

      setRealtimeStatus(isReconnect ? 'reconnecting' : 'connecting')

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
            const wasReconnect = reconnectAttemptsRef.current > 0
            reconnectAttemptsRef.current = 0
            setRealtimeStatus('connected')
            stopPolling()
            if (wasReconnect) {
              fetchDraftPicks()
              fetchCounterpicks()
            }
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttemptsRef.current++
              const delay = BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1)
              reconnectTimeoutRef.current = setTimeout(() => setupChannel(true), delay)
            } else {
              setRealtimeStatus('error')
              startPolling()
            }
          }
        })

      currentChannel = channel
    }

    setupChannel()

    return () => {
      isCleaningUp = true
      stopPolling()
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (currentChannel) {
        supabase.removeChannel(currentChannel)
      }
      reconnectAttemptsRef.current = 0
    }
  }, [league.id, supabase, fetchDraftPicks, fetchParticipants, fetchCounterpicks, startPolling, stopPolling])

  // Safety-net cleanup for polling interval
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  const handlePickMade = useCallback(async () => {
    await fetchDraftPicks()
  }, [fetchDraftPicks])

  const handleCounterpickMade = useCallback(async () => {
    await fetchCounterpicks()
    await fetchDraftPicks() // Also refetch draft picks to get updated counterpicked_by_team_id
  }, [fetchCounterpicks, fetchDraftPicks])

  async function handleStartDraft(): Promise<void> {
    if (participants.length < 2) {
      setError('Need at least 2 participants to start the draft')
      return
    }

    setStartingDraft(true)
    setError(null)

    const { data, error: startError } = await callEdgeFunction<{ league: League }>('start-draft', {
      body: { league_id: league.id },
    })

    if (startError) {
      setError(startError)
    } else if (data?.league) {
      setLeague(data.league)
    }

    setStartingDraft(false)
  }

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
            data-testid="start-draft-button"
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

      {(league.status === 'drafting' || league.status === 'counterpicking') && (
        <div className="mb-4 flex items-center justify-between">
          <ConnectionStatusIndicator status={realtimeStatus} />
          {realtimeStatus === 'error' && (
            <span className="text-xs text-foreground-muted">Updates every 10s</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="order-2 lg:order-1 lg:col-span-2">
          <DraftBoard
            league={league}
            participants={participants}
            draftPicks={draftPicks}
            counterpicks={counterpicks}
            currentUserId={currentUserId}
            onPickMade={handlePickMade}
            onCounterpickMade={handleCounterpickMade}
          />
        </div>

        <div className="order-1 lg:order-2 space-y-6 lg:sticky lg:top-6 lg:self-start">
          <ParticipantsList participants={participants} ownerId={league.owner_id} />

          {league.status === 'drafting' && draftPicks.length > 0 && (
            <div className="card p-4 lg:p-6" data-testid="draft-history">
              <h3 className="text-lg font-display font-semibold text-foreground mb-4">
                Pick History
              </h3>
              <div className="hidden lg:block">
                <PickHistory draftPicks={draftPicks} teamInfoById={teamInfoById} />
              </div>
              <div className="lg:hidden">
                <div className={pickHistoryExpanded ? 'max-h-[50vh] overflow-y-auto' : ''}>
                  <PickHistory
                    draftPicks={pickHistoryExpanded ? draftPicks : draftPicks.slice(-3)}
                    teamInfoById={teamInfoById}
                  />
                </div>
                {draftPicks.length > 3 && (
                  <button
                    onClick={() => setPickHistoryExpanded((prev) => !prev)}
                    className="w-full mt-3 text-sm text-gold hover:text-gold-hover font-medium transition-colors"
                    aria-expanded={pickHistoryExpanded}
                    data-testid="pick-history-expand"
                  >
                    {pickHistoryExpanded ? 'Show less' : `Show all ${draftPicks.length} picks`}
                  </button>
                )}
              </div>
            </div>
          )}

          {isOwner && league.status === 'setup' && (
            <>
              <JoinLinkCard
                league={league}
                onUpdate={setLeague}
              />
              <InvitationsList
                leagueId={league.id}
                isOwner={isOwner}
                leagueStatus={league.status}
              />
            </>
          )}
        </div>
      </div>

      {showInviteModal && (
        <InviteModal leagueId={league.id} onClose={() => setShowInviteModal(false)} />
      )}
    </>
  )
}
