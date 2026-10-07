'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { realtimeErrorText } from '@/utils/supabase/realtimeDiagnostics'
import { addBreadcrumb, captureMessage } from '@/utils/sentry'
import { trackEvent } from '@/utils/analytics'
import type { League, ParticipantWithProfile, DraftPickWithDetails, CounterpickWithDetails } from '@/types'
import type { RealtimeStatus } from '@/app/(authenticated)/league/[id]/components/ConnectionStatusIndicator'
import type { Politeness } from '@/utils/announce'

export interface DraftState {
  league: League
  participants: ParticipantWithProfile[]
  draftPicks: DraftPickWithDetails[]
  counterpicks: CounterpickWithDetails[]
}

const POLL_INTERVAL_MS = 10_000
const LIVE_RECONCILE_INTERVAL_MS = 5_000
const REALTIME_FALLBACK_MS = 10_000
const REFRESH_TIMEOUT_MS = 15_000
const PHASE_ORDER = { setup: 0, drafting: 1, counterpicking: 2, active: 3, completed: 4 }

interface Options {
  /**
   * Called with the previous and new confirmed state whenever a read or a
   * mutation response changes what is shown - except the first read after the
   * server render, which only reconciles the snapshot the page loaded with.
   */
  onConfirmedChange?: (previous: DraftState, latest: DraftState) => void
}

export function useDraftState(initialState: DraftState, options: Options = {}) {
  const [state, setState] = useState(initialState)
  const stateRef = useRef(initialState)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting')
  const supabase = useMemo(() => createClient(), [])
  const leagueId = initialState.league.id
  const refreshRef = useRef<() => Promise<boolean>>(async () => false)
  const onChangeRef = useRef(options.onConfirmedChange)
  const syncedRef = useRef(false)
  const refresh = useCallback(() => refreshRef.current(), [])
  const getSnapshot = useCallback(() => stateRef.current, [])
  const acceptLeague = useCallback((league: League) => {
    // A delayed mutation response must not undo a phase already observed live.
    if (league.id !== stateRef.current.league.id || PHASE_ORDER[league.status] < PHASE_ORDER[stateRef.current.league.status]) return
    const previous = stateRef.current
    stateRef.current = { ...previous, league }
    setState(stateRef.current)
    if (previous.league.status !== league.status) onChangeRef.current?.(previous, stateRef.current)
  }, [])

  // Declared before the subscription effect, which must stay the last effect.
  useEffect(() => { onChangeRef.current = options.onConfirmedChange }, [options.onConfirmedChange])

  useEffect(() => {
    let disposed = false
    let requestedVersion = 0
    let inFlight: Promise<boolean> | null = null
    let pollingTimer: ReturnType<typeof setInterval> | null = null
    let liveReconciliationTimer: ReturnType<typeof setInterval> | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    let degraded = false
    let warningSent = false
    let activeRequest: AbortController | null = null

    // Coalesce events during a read, then read again before applying anything.
    // An older HTTP response must never overwrite a later mutation/event.
    async function readLatest(): Promise<boolean> {
      // All coalesced follow-ups share one deadline, so a busy draft cannot
      // keep a mutation's reconciliation promise pending indefinitely.
      const deadlineAt = performance.now() + REFRESH_TIMEOUT_MS
      try {
        while (!disposed) {
          const version = requestedVersion
          const controller = new AbortController()
          activeRequest = controller
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            const remainingMs = deadlineAt - performance.now()
            if (remainingMs <= 0) {
              controller.abort(new Error('Draft refresh timed out'))
              throw controller.signal.reason
            }
            const [league, participants, draftPicks, counterpicks] = await Promise.race([
              Promise.all([
                supabase.from('leagues').select('*').eq('id', leagueId).abortSignal(controller.signal).single(),
                supabase.from('league_participants').select('*, teams (*), profiles (*)')
                  .eq('league_id', leagueId).eq('status', 'active').order('draft_order')
                  .abortSignal(controller.signal),
                supabase.from('draft_picks').select('*, movies (*), teams!draft_picks_team_id_fkey (*)')
                  .eq('league_id', leagueId).order('round').order('pick_number').abortSignal(controller.signal),
                supabase.from('counterpicks').select('*, movies (*)').eq('league_id', leagueId)
                  .order('pick_order').abortSignal(controller.signal),
              ]),
              new Promise<never>((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
                timeout = setTimeout(() => controller.abort(new Error('Draft refresh timed out')), remainingMs)
              }),
            ])
            if (disposed) return false
            const error = [league, participants, draftPicks, counterpicks].find(result => result.error)?.error
            if (error || !league.data) throw error ?? new Error('League unavailable')
            if (version !== requestedVersion) continue
            const latest = {
              league: league.data as League,
              participants: participants.data as ParticipantWithProfile[],
              draftPicks: draftPicks.data as DraftPickWithDetails[],
              counterpicks: counterpicks.data as CounterpickWithDetails[],
            }
            const previous = stateRef.current
            stateRef.current = latest
            setState(latest)
            setSyncError(null)
            if (syncedRef.current) onChangeRef.current?.(previous, latest)
            syncedRef.current = true
            return true
          } catch (error) {
            if (disposed) return false
            // A timeout must release the worker even if polling requested newer data.
            if (!controller.signal.aborted && version !== requestedVersion) continue
            setSyncError('Draft updates could not be loaded. Your last confirmed state is shown. Retry before making another pick.')
            addBreadcrumb({ category: 'draft.sync', message: 'refresh failed', level: 'error', data: { error: realtimeErrorText(error) } })
            return false
          } finally {
            clearTimeout(timeout)
            activeRequest = null
          }
        }
        return false
      } finally {
        // Clear before resolving so an event cannot join an already-finished read.
        inFlight = null
      }
    }

    function requestRefresh(invalidate = true): Promise<boolean> {
      if (disposed) return Promise.resolve(false)
      // A routine polling tick can share the current read. Only actual changes
      // or explicit recovery requests make that read too old to apply.
      if (inFlight && !invalidate) return inFlight
      requestedVersion += 1
      // Defer the worker until its promise is stored, including synchronous failures.
      if (!inFlight) inFlight = Promise.resolve().then(readLatest)
      return inFlight
    }
    refreshRef.current = requestRefresh

    function stopPolling() {
      if (pollingTimer) clearInterval(pollingTimer)
      pollingTimer = null
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = null
    }

    function stopLiveReconciliation() {
      if (liveReconciliationTimer) clearInterval(liveReconciliationTimer)
      liveReconciliationTimer = null
    }

    function startPolling() {
      if (disposed) return
      setRealtimeStatus('polling')
      if (pollingTimer) return
      void requestRefresh()
      pollingTimer = setInterval(() => void requestRefresh(false), POLL_INTERVAL_MS)
    }

    // removeChannel is asynchronous and this SDK reuses channels by topic.
    // A unique topic per effect prevents a rapid remount from inheriting the
    // previous effect's leaving channel. SDK still owns all transport retries.
    let channel = supabase.channel(`draft-${leagueId}-${crypto.randomUUID()}`)
    for (const table of ['draft_picks', 'league_participants', 'counterpicks', 'leagues']) {
      channel = channel.on('postgres_changes', {
        event: '*', schema: 'public', table,
        filter: `${table === 'leagues' ? 'id' : 'league_id'}=eq.${leagueId}`,
      }, () => { void requestRefresh() })
    }
    function handleSubscriptionStatus(status: string, error?: unknown) {
      if (disposed) return
      stopLiveReconciliation()
      addBreadcrumb({ category: 'realtime.channel', message: status, data: {
        league_id: leagueId, error: realtimeErrorText(error), visibility: document.visibilityState,
        online: navigator.onLine, socket_state: supabase.realtime.connectionState(),
      } })
      if (status === 'SUBSCRIBED') {
        stopPolling()
        setRealtimeStatus('connected')
        void requestRefresh() // Also closes the initial SSR-to-subscription gap.
        // A joined socket does not prove every database event was delivered.
        // Bound stale state even when the transport reports no interruption.
        liveReconciliationTimer = setInterval(() => void requestRefresh(false), LIVE_RECONCILE_INTERVAL_MS)
        if (degraded) trackEvent('realtime_recovered', { league_id: leagueId })
        degraded = false
      } else {
        if (!degraded) trackEvent('realtime_degraded', { league_id: leagueId, status })
        degraded = true
        if (!warningSent) {
          warningSent = true
          captureMessage('Draft realtime channel degraded', { level: 'warning',
            tags: { league_id: leagueId }, extra: { status, error: realtimeErrorText(error), online: navigator.onLine, visibility: document.visibilityState } })
        }
        if (status === 'CLOSED') startPolling()
        else {
          setRealtimeStatus(pollingTimer ? 'polling' : 'reconnecting')
          if (!fallbackTimer) fallbackTimer = setTimeout(startPolling, REALTIME_FALLBACK_MS)
        }
      }
    }
    fallbackTimer ??= setTimeout(startPolling, REALTIME_FALLBACK_MS)
    // This SDK can buffer a tokenless join before its async Auth callback
    // resolves, then skip sending the now-cached token after SUBSCRIBED.
    // Resolve Auth before subscribe constructs that first join payload.
    void supabase.realtime.setAuth().then(() => {
      if (!disposed) channel.subscribe(handleSubscriptionStatus)
    }).catch(error => handleSubscriptionStatus('CHANNEL_ERROR', error))

    const resume = () => { void requestRefresh() }
    const visible = () => { if (document.visibilityState === 'visible') resume() }
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', visible)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      addBreadcrumb({ category: 'realtime.auth', message: event, data: {
        expires_in_seconds: session?.expires_at ? session.expires_at - Math.floor(Date.now() / 1000) : undefined,
      } })
      // Defer queries until the auth callback releases its lock.
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') queueMicrotask(resume)
    })

    return () => {
      disposed = true
      activeRequest?.abort()
      stopPolling()
      stopLiveReconciliation()
      subscription.unsubscribe()
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', visible)
      void supabase.removeChannel(channel)
    }
  }, [leagueId, supabase])

  return { ...state, refresh, getSnapshot, acceptLeague, syncError, realtimeStatus }
}

/** Whoever is up at one pick of the draft or its counterpick round. */
interface DraftTurn {
  round: number
  pickNumber: number
  userId: string
  teamName: string
}

/**
 * Who is up at a zero-based pick index. The draft snakes (1-2-3, 3-2-1); the
 * counterpick round runs the reverse snake (3-2-1, 1-2-3), exactly as the
 * get_next_counterpick_turn RPC does.
 */
function turnAt(
  participants: ParticipantWithProfile[],
  index: number,
  rounds: number,
  reverse = false,
): DraftTurn | null {
  const count = participants.length
  if (count === 0 || index >= count * rounds) return null
  const round = Math.floor(index / count) + 1
  const pickNumber = (index % count) + 1
  const ascending = (round % 2 === 1) !== reverse
  const draftOrder = ascending ? pickNumber : count - pickNumber + 1
  const participant = participants.find((p) => p.draft_order === draftOrder)
  if (!participant) return null
  return { round, pickNumber, userId: participant.user_id, teamName: participant.teams?.name ?? 'Unknown team' }
}

function currentTurn({ league, participants, draftPicks, counterpicks }: DraftState): DraftTurn | null {
  if (league.status === 'drafting') return turnAt(participants, draftPicks.length, league.draft_slots)
  if (league.status === 'counterpicking') {
    const made = counterpicks.filter((pick) => pick.phase !== 'bidding').length
    return turnAt(participants, made, league.draft_counterpick_slots, true)
  }
  return null
}

/** One sentence on whose turn it is, for screen-reader announcements. */
export function describeTurn(state: DraftState, currentUserId: string): { message: string; isMine: boolean } | null {
  const turn = currentTurn(state)
  const counterpicking = state.league.status === 'counterpicking'
  if (!turn) {
    return state.league.status === 'drafting' && state.participants.length > 0
      ? { message: 'All draft picks are in. Waiting for the league owner to choose the next phase.', isMine: false }
      : null
  }
  const where = `round ${turn.round}, pick ${turn.pickNumber}`
  return turn.userId === currentUserId
    ? { message: `It's your turn to ${counterpicking ? 'counterpick' : 'draft'} (${where}).`, isMine: true }
    : { message: `${turn.teamName} is ${counterpicking ? 'counterpicking' : 'picking'} (${where}).`, isMine: false }
}

export interface DraftAnnouncement {
  message: string
  /** Only when the change made it the viewer's turn. */
  assertive: boolean
}

/**
 * Speaks draft news to screen readers. `lead` puts the message first among
 * those spoken together, e.g. "You drafted Dune" before whose turn is next.
 */
export type DraftAnnouncer = (message: string, politeness?: Politeness, lead?: boolean) => void

const PHASE_NEWS: Partial<Record<League['status'], string>> = {
  drafting: 'The draft has started.',
  counterpicking: 'The counterpick round has started.',
  active: 'The draft is complete. The league is now active.',
  completed: 'The season is complete.',
}

/** A reconnect can deliver several picks at once: say how many, then the latest. */
function summarize(lines: string[], noun: string): string[] {
  return lines.length <= 2 ? lines : [`${lines.length} new ${noun}. Latest: ${lines[lines.length - 1]}`]
}

/**
 * What a screen-reader user needs to hear about a confirmed change: who picked
 * what, a new phase, and whose turn it now is. The viewer's own picks are left
 * out - the pick flow confirms those itself, so they are not heard twice.
 */
export function describeDraftChange(
  previous: DraftState,
  latest: DraftState,
  currentUserId: string,
): DraftAnnouncement | null {
  const teamNames = new Map<string, string>()
  for (const participant of latest.participants) {
    if (participant.teams) teamNames.set(participant.teams.id, participant.teams.name)
  }
  const teamName = (teamId: string) => teamNames.get(teamId) ?? 'Another team'
  const myTeamId = latest.participants.find((p) => p.user_id === currentUserId)?.teams?.id
  const status = latest.league.status
  const news: string[] = []

  if (status !== previous.league.status) {
    const phase = PHASE_NEWS[status]
    if (phase) news.push(phase)
  } else if (status === 'drafting') {
    const seen = new Set(previous.draftPicks.map((pick) => pick.id))
    news.push(...summarize(latest.draftPicks
      .filter((pick) => !seen.has(pick.id) && pick.team_id !== myTeamId)
      .map((pick) => `${teamName(pick.team_id)} drafted ${pick.movies?.title ?? 'a movie'} (round ${pick.round}, pick ${pick.pick_number}).`), 'picks'))
  } else if (status === 'counterpicking') {
    const seen = new Set(previous.counterpicks.map((pick) => pick.id))
    news.push(...summarize(latest.counterpicks
      .filter((pick) => !seen.has(pick.id) && pick.counterpicker_team_id !== myTeamId)
      .map((pick) => `${teamName(pick.counterpicker_team_id)} counterpicked ${teamName(pick.target_team_id)}'s ${pick.movies?.title ?? 'movie'}.`), 'counterpicks'))
  }

  if (news.length === 0) return null
  const turn = describeTurn(latest, currentUserId)
  if (turn) news.push(turn.message)
  return { message: news.join(' '), assertive: Boolean(turn?.isMine) }
}
