'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { realtimeErrorText } from '@/utils/supabase/realtimeDiagnostics'
import { addBreadcrumb, captureMessage } from '@/utils/sentry'
import { trackEvent } from '@/utils/analytics'
import type { League, ParticipantWithProfile, DraftPickWithDetails, CounterpickWithDetails } from '@/types'
import type { RealtimeStatus } from '@/app/(authenticated)/league/[id]/components/ConnectionStatusIndicator'

export interface DraftState {
  league: League
  participants: ParticipantWithProfile[]
  draftPicks: DraftPickWithDetails[]
  counterpicks: CounterpickWithDetails[]
}

const POLL_INTERVAL_MS = 10_000
const REALTIME_FALLBACK_MS = 10_000
const REFRESH_TIMEOUT_MS = 15_000
const PHASE_ORDER = { setup: 0, drafting: 1, counterpicking: 2, active: 3, completed: 4 }

export function useDraftState(initialState: DraftState) {
  const [state, setState] = useState(initialState)
  const stateRef = useRef(initialState)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting')
  const supabase = useMemo(() => createClient(), [])
  const leagueId = initialState.league.id
  const refreshRef = useRef<() => Promise<boolean>>(async () => false)
  const refresh = useCallback(() => refreshRef.current(), [])
  const getSnapshot = useCallback(() => stateRef.current, [])
  const acceptLeague = useCallback((league: League) => {
    // A delayed mutation response must not undo a phase already observed live.
    if (league.id !== stateRef.current.league.id || PHASE_ORDER[league.status] < PHASE_ORDER[stateRef.current.league.status]) return
    stateRef.current = { ...stateRef.current, league }
    setState(stateRef.current)
  }, [])

  useEffect(() => {
    let disposed = false
    let requestedVersion = 0
    let inFlight: Promise<boolean> | null = null
    let pollingTimer: ReturnType<typeof setInterval> | null = null
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
            stateRef.current = latest
            setState(latest)
            setSyncError(null)
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
    channel.subscribe((status, error) => {
      if (disposed) return
      addBreadcrumb({ category: 'realtime.channel', message: status, data: {
        league_id: leagueId, error: realtimeErrorText(error), visibility: document.visibilityState,
        online: navigator.onLine, socket_state: supabase.realtime.connectionState(),
      } })
      if (status === 'SUBSCRIBED') {
        stopPolling()
        setRealtimeStatus('connected')
        void requestRefresh() // Also closes the initial SSR-to-subscription gap.
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
    })
    fallbackTimer ??= setTimeout(startPolling, REALTIME_FALLBACK_MS)

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
      subscription.unsubscribe()
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', visible)
      void supabase.removeChannel(channel)
    }
  }, [leagueId, supabase])

  return { ...state, refresh, getSnapshot, acceptLeague, syncError, realtimeStatus }
}
