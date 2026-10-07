'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Target } from 'lucide-react'
import { describeDraftChange, useDraftState, type DraftAnnouncer, type DraftState } from '@/hooks/useDraftState'
import { announce } from '@/utils/announce'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { trackEvent } from '@/utils/analytics'
import type { League, ParticipantWithProfile, DraftPickWithDetails, CounterpickWithDetails } from '@/types'
import DraftBoard, { PickHistory } from '../components/DraftBoard'
import ConnectionStatusIndicator from '../components/ConnectionStatusIndicator'
import { buildTeamInfoByTeamId } from '@/utils/league'
import InvitationsList from '../components/InvitationsList'
import JoinLinkCard from '../components/JoinLinkCard'
import ParticipantsList from '../components/ParticipantsList'
import type { ReigningChampions } from '@/utils/seasonQueries'
import { SpinnerIcon } from '../components/Icons'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const InviteModal = dynamic(() => import('../components/InviteModal'), {
  loading: () => (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4" role="status">
      <span className="sr-only">Loading invite form</span>
      <div className="animate-pulse h-64 w-full max-w-md bg-surface rounded-lg" aria-hidden="true" />
    </div>
  ),
})

/**
 * Messages that land together - a confirmed pick, the phase it ended, whose
 * turn is next - are read as one, so a later one never cuts off an earlier one.
 * The short wait also lets a closing dialog go first: a message spoken into a
 * dialog that is about to close would be lost with it.
 */
const ANNOUNCE_GATHER_MS = 250

function useGatheredAnnouncer(): DraftAnnouncer {
  const queue = useRef<{ parts: string[]; assertive: boolean; timer: number | null }>({ parts: [], assertive: false, timer: null })
  useEffect(() => () => {
    if (queue.current.timer !== null) window.clearTimeout(queue.current.timer)
  }, [])
  return useCallback((message, politeness = 'polite', lead = false) => {
    const pending = queue.current
    if (lead) pending.parts.unshift(message)
    else pending.parts.push(message)
    pending.assertive ||= politeness === 'assertive'
    if (pending.timer !== null) return
    pending.timer = window.setTimeout(() => {
      announce(pending.parts.join(' '), pending.assertive ? 'assertive' : 'polite')
      queue.current = { parts: [], assertive: false, timer: null }
    }, ANNOUNCE_GATHER_MS)
  }, [])
}

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  draftPicks: DraftPickWithDetails[]
  counterpicks: CounterpickWithDetails[]
  currentUserId: string
  isOwner: boolean
  /** Last season's winners, crowned in the participants list. */
  reigningChampions?: ReigningChampions | null
}

export default function DraftClient({
  league: initialLeague,
  participants: initialParticipants,
  draftPicks: initialDraftPicks,
  counterpicks: initialCounterpicks,
  currentUserId,
  isOwner,
  reigningChampions = null,
}: Props): React.ReactElement {
  const speak = useGatheredAnnouncer()
  // Live news for screen readers at every width: picks by others, counterpicks,
  // phase changes and - assertively - the viewer's own turn.
  const announceChange = useCallback((previous: DraftState, latest: DraftState) => {
    const update = describeDraftChange(previous, latest, currentUserId)
    if (update) speak(update.message, update.assertive ? 'assertive' : 'polite')
  }, [currentUserId, speak])
  const { league, participants, draftPicks, counterpicks, refresh, getSnapshot, acceptLeague, syncError, realtimeStatus } = useDraftState({
    league: initialLeague,
    participants: initialParticipants,
    draftPicks: initialDraftPicks,
    counterpicks: initialCounterpicks,
  }, { onConfirmedChange: announceChange })
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  const [pickHistoryExpanded, setPickHistoryExpanded] = useState(false)
  const router = useRouter()
  const phase = `${league.id}:${league.status}`
  const previousPhase = useRef(phase)
  const boardRef = useRef<HTMLDivElement>(null)
  const skipTriggerRef = useRef<HTMLButtonElement>(null)
  const skipConfirmTextRef = useRef<HTMLParagraphElement>(null)
  const skipConfirmId = useId()
  const startDraftHelpId = useId()
  const lastFocused = useRef<Element | null>(null)

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Element) lastFocused.current = event.target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  useEffect(() => {
    if (previousPhase.current === phase) return
    previousPhase.current = phase
    // The shared header and navigation are server-rendered. Refresh them when
    // a confirmed phase changes, without restarting the draft on every pick.
    router.refresh()
    // A new phase swaps the board and the owner controls. When that removed
    // the control the viewer was on, land on the new board's heading rather
    // than the top of the document. Anyone else keeps their reading position;
    // the announcer tells them the phase changed.
    const focused = lastFocused.current
    const focusLost = !document.activeElement || document.activeElement === document.body
    if (focused && !focused.isConnected && focusLost) {
      lastFocused.current = null
      boardRef.current?.querySelector<HTMLElement>('[data-draft-heading]')?.focus({ preventScroll: true })
    }
  }, [phase, router])

  useEffect(() => {
    if (showSkipConfirm) skipConfirmTextRef.current?.focus()
  }, [showSkipConfirm])

  function cancelSkipConfirm(): void {
    setShowSkipConfirm(false)
    skipTriggerRef.current?.focus()
  }

  const teamInfoById = useMemo(() => buildTeamInfoByTeamId(participants), [participants])
  const handlePickMade = useCallback(async (confirmedLeague?: League) => {
    if (confirmedLeague) acceptLeague(confirmedLeague)
    return await refresh() ? getSnapshot() : null
  }, [refresh, getSnapshot, acceptLeague])

  const handleCounterpickMade = handlePickMade

  const startDraftAction = useCallback(async (): Promise<void> => {
    if (participants.length < 2) {
      throw new Error('Need at least 2 participants to start the draft')
    }

    const { data, error: startError } = await callEdgeFunction<{ league: League }>('start-draft', {
      timeoutMs: 30_000,
      body: { league_id: league.id },
    })

    if (startError || !data?.league) throw new Error(startError || 'Draft start could not be confirmed.')
    acceptLeague(data.league)
    await refresh()
    trackEvent('draft_started', { league_id: league.id })
  }, [participants.length, league.id, acceptLeague, refresh])
  const { execute: startDraft, isLoading: startingDraft, error: startDraftError } = useAsyncAction(startDraftAction)

  const skipCounterpickAction = useCallback(async (): Promise<void> => {
    const { data, error: skipError } = await callEdgeFunction<{ league: League }>('skip-counterpick-round', {
      timeoutMs: 30_000,
      body: { league_id: league.id, end_remaining: league.status === 'counterpicking' },
    })
    if (skipError) {
      throw new Error(skipError)
    }
    if (data?.league) acceptLeague(data.league)
    await refresh()
    setShowSkipConfirm(false)
  }, [league.id, league.status, acceptLeague, refresh])

  const { execute: handleSkipCounterpick, isLoading: skipping, error: skipError } = useAsyncAction(skipCounterpickAction)

  const totalPicks = participants.length * league.draft_slots
  const isDraftComplete = league.status === 'drafting' && draftPicks.length >= totalPicks
  const canStartCounterpick =
    isOwner &&
    isDraftComplete &&
    league.draft_counterpick_slots > 0

  const startCounterpickAction = useCallback(async (): Promise<void> => {
    const { data, error: startError } = await callEdgeFunction<{ league: League }>('start-counterpick-round', {
      timeoutMs: 30_000,
      body: { league_id: league.id },
    })

    if (startError) throw new Error(startError)
    if (data?.league) acceptLeague(data.league)
    await refresh()
  }, [league.id, acceptLeague, refresh])
  const { execute: startCounterpick, isLoading: startingCounterpick, error: startCounterpickError } = useAsyncAction(startCounterpickAction)
  const error = startDraftError || startCounterpickError
  const canEndCounterpicks = isOwner && league.status === 'counterpicking'

  return (
    <>
      {/* Owner Controls for Setup */}
      {isOwner && league.status === 'setup' && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button onClick={() => setShowInviteModal(true)} className="btn btn-secondary">
            Invite players
          </button>
          <button
            onClick={() => { void startDraft().catch(() => {}) }}
            disabled={startingDraft || participants.length < 2 || Boolean(syncError)}
            aria-describedby={participants.length < 2 ? startDraftHelpId : undefined}
            className="btn btn-primary"
            data-testid="start-draft-button"
          >
            {startingDraft ? 'Starting...' : 'Start Draft'}
          </button>
          {participants.length < 2 && (
            <span id={startDraftHelpId} className="type-body-sm text-foreground-secondary">
              The draft needs at least 2 players.
            </span>
          )}
          {error && <span className="type-body-sm text-error" role="alert">{error}</span>}
        </div>
      )}

      {/* Owner Controls for Starting Counterpick Round */}
      {(canStartCounterpick || canEndCounterpicks) && (
        <div className="mb-6">
          <div className="card p-4 bg-crimson/10 border-crimson/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-crimson/20 rounded-full flex items-center justify-center">
                  <Target className="w-5 h-5 text-crimson-text" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{canEndCounterpicks ? 'Finish counterpicks' : 'Draft complete!'}</p>
                  <p className="type-body-sm text-foreground-secondary">
                    {canEndCounterpicks ? 'If players cannot make any more picks, end the remaining round and keep counterpicks already made.' : `Ready to start the counterpick round (${league.draft_counterpick_slots} picks per team)`}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {canStartCounterpick && <button
                  onClick={() => { void startCounterpick().catch(() => {}) }}
                  disabled={startingCounterpick || skipping}
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
                      Start counterpick round
                    </>
                  )}
                </button>}
                <button
                  ref={skipTriggerRef}
                  onClick={() => (showSkipConfirm ? cancelSkipConfirm() : setShowSkipConfirm(true))}
                  disabled={startingCounterpick || skipping}
                  aria-expanded={showSkipConfirm}
                  aria-controls={showSkipConfirm ? skipConfirmId : undefined}
                  className="type-control cursor-pointer text-foreground-secondary hover:text-foreground transition-colors"
                >
                  {canEndCounterpicks ? 'End remaining counterpicks' : 'Skip & activate league'}
                </button>
              </div>
            </div>

            {/* Inline skip confirmation */}
            {showSkipConfirm && (
              <div id={skipConfirmId} className="mt-3 p-3 bg-elevated rounded-lg border border-border animate-fade-in">
                <p ref={skipConfirmTextRef} tabIndex={-1} className="type-body-sm text-foreground-secondary mb-3">
                  {canEndCounterpicks ? 'End the remaining counterpicks and activate the league? Existing counterpicks will be kept. This cannot be undone.' : "Skip the counterpick round? Teams won't be able to claim draft-phase counterpicks."}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void handleSkipCounterpick().catch(() => {}) }}
                    disabled={skipping}
                    className="type-control btn btn-danger py-1.5 px-4"
                  >
                    {skipping ? (
                      <>
                        <SpinnerIcon className="w-3 h-3 animate-spin mr-1" />
                        Skipping...
                      </>
                    ) : (
                      canEndCounterpicks ? 'Confirm end of round' : 'Confirm Skip'
                    )}
                  </button>
                  <button
                    onClick={cancelSkipConfirm}
                    disabled={skipping}
                    className="type-control btn btn-ghost py-1.5 px-4"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(error || skipError) && <p className="type-body-sm mt-3 text-error" role="alert">{error || skipError}</p>}
          </div>
        </div>
      )}

      {(league.status === 'drafting' || league.status === 'counterpicking') && (
        <div className="mb-4 flex items-center justify-between">
          <ConnectionStatusIndicator status={realtimeStatus} />
          {realtimeStatus === 'polling' && (
            <span className="type-meta text-foreground-secondary">Updates every 10s</span>
          )}
        </div>
      )}

      {syncError && (
        <div className="alert alert-error mb-4" role="alert">
          <p>{syncError}</p>
          <button className="btn btn-secondary mt-2" onClick={() => { void refresh() }}>Retry updates</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="order-1 lg:col-span-2" ref={boardRef}>
          <DraftBoard
            league={league}
            participants={participants}
            draftPicks={draftPicks}
            counterpicks={counterpicks}
            currentUserId={currentUserId}
            onPickMade={handlePickMade}
            onCounterpickMade={handleCounterpickMade}
            onAnnounce={speak}
            updatesUnavailable={Boolean(syncError)}
          />
        </div>

        <div className="order-2 space-y-6 lg:sticky lg:top-6 lg:self-start">
          <ParticipantsList
            participants={participants}
            ownerId={league.owner_id}
            reigningChampions={reigningChampions}
          />

          {league.status === 'drafting' && draftPicks.length > 0 && (
            <div className="card p-4 lg:p-6" data-testid="draft-history">
              <h2 className="type-panel text-foreground mb-4">
                Pick history
              </h2>
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
                    className="type-control w-full mt-3 text-gold hover:text-gold-hover transition-colors"
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
              <JoinLinkCard leagueId={league.id} />
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
