'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/utils/supabase/client'
import { captureException } from '@/utils/sentry'
import { trackEvent } from '@/utils/analytics'
import { getTour, TOUR_LIST, type TourId } from '@/tours/registry'
import {
  applicableSteps,
  isTourSeen,
  pickAutoStart,
  tourKey,
  toursEnabled,
  TOURS_PREF_KEY,
  TOUR_KEY_PREFIX,
  type TourOutcome,
  type TourState,
  type UiStateRow,
} from '@/tours/engine'
import type { ResolvedStep, TourContext, TourDefinition } from '@/tours/types'
import TourOverlay from './TourOverlay'
import { findTourAnchor, topModal } from './anchors'

/** A page gets this long to settle (data, skeletons, Suspense) before its tour starts by itself. */
const AUTO_START_DELAY_MS = 800
/** While waiting for anchors or for a dialog to close, how often to look again. */
const POLL_MS = 250
/** Anchors count as settled once the set found stays the same this many polls running. */
const STABLE_POLLS = 3
/**
 * An automatic start with some anchors still missing waits longer, so steps
 * whose elements arrive with a client fetch (bid cards, trade offers) aren't
 * dropped just because a server-rendered anchor was already there.
 */
const PARTIAL_STABLE_POLLS = 12
/** Give up waiting for an auto-started tour's anchors after this long. */
const AUTO_START_TIMEOUT_MS = 8000

interface Registration {
  order: number
  id: TourId
  ctx: TourContext
}

export interface ActiveTour {
  tour: TourDefinition
  /** Fixed when the tour starts, so "Step 2 of 4" stays honest. */
  steps: ResolvedStep[]
  index: number
  /** Started by the page rather than by the user asking for it. */
  automatic: boolean
}

interface ToursContextValue {
  /** False when progress could not be loaded: nothing starts by itself then. */
  ready: boolean
  /** Automatic tours are on (the user can turn them off). */
  enabled: boolean
  tourState: (id: string) => TourState | undefined
  isSeen: (id: string) => boolean
  /** Tours the page on screen offers right now, applicable to this viewer. */
  pageTours: TourId[]
  /** Start a tour the page offers. Returns false when it doesn't apply here. */
  start: (id: TourId) => Promise<boolean>
  /** Forget how one tour ended, or every tour when no id is given. */
  reset: (id?: TourId) => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  /** Called by <FeatureTour>; returns an update and an unregister function. */
  register: (id: TourId, ctx: TourContext) => { update: (ctx: TourContext) => void; unregister: () => void }
}

const ToursContext = createContext<ToursContextValue | null>(null)

export function useTours(): ToursContextValue {
  const value = useContext(ToursContext)
  if (!value) throw new Error('useTours must be used inside <TourProvider>')
  return value
}

/** Typing in a field: a tour that took focus now would eat keystrokes. */
function isEditing(): boolean {
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/**
 * Browser tests drive the app through automation, and a tour popping up over
 * the page would get in their way. They see tours only when they ask to, by
 * setting `window.__FANTASY_REEL_TOURS__ = true` before the page loads.
 */
function automationOptedOut(): boolean {
  const optedIn = (window as Window & { __FANTASY_REEL_TOURS__?: boolean }).__FANTASY_REEL_TOURS__ === true
  return navigator.webdriver && !optedIn
}

/**
 * Waits for the page to settle, then returns the steps that can show: steps
 * without an anchor, and anchored ones whose element is on screen (or that
 * may stand in centered). Null when the tour should not start: cancelled,
 * timed out, or - for an automatic start - nothing to point at but an intro.
 */
async function planSteps(
  steps: ResolvedStep[],
  automatic: boolean,
  cancelled: () => boolean
): Promise<ResolvedStep[] | null> {
  const anchored = steps.filter((step) => step.anchor)
  const deadline = Date.now() + (automatic ? AUTO_START_TIMEOUT_MS : POLL_MS * STABLE_POLLS)
  let previous = ''
  let stableFor = 0

  for (;;) {
    if (cancelled()) return null
    const found = anchored.filter((step) => findTourAnchor(step.anchor!) !== null)
    const signature = found.map((step) => step.anchor).join('|')
    stableFor = signature === previous ? stableFor + 1 : 0
    previous = signature

    const required = automatic && found.length < anchored.length ? PARTIAL_STABLE_POLLS : STABLE_POLLS
    const settled = stableFor >= required - 1 && (anchored.length === 0 || found.length > 0)
    const blocked = automatic && (isEditing() || topModal() !== null)
    if (settled && !blocked) {
      return steps.filter((step) => !step.anchor || step.centerIfMissing || found.includes(step))
    }
    if (Date.now() > deadline) {
      // Asked for by the user: show what there is. Automatic: try another visit.
      return automatic ? null : steps.filter((step) => !step.anchor || step.centerIfMissing || found.includes(step))
    }
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS))
  }
}

interface Props {
  userId: string
  /** The user's `user_ui_state` rows, read by the server layout; null when that read failed. */
  initialState: UiStateRow[] | null
  children: React.ReactNode
}

/**
 * Owns guided tours for the signed-in app: how each one ended for this user
 * (`user_ui_state`), which ones the page on screen offers (registered by
 * <FeatureTour>), and the one showing. Mounted once in the authenticated
 * layout. See docs/TOURS.md.
 */
export function TourProvider({ userId, initialState, children }: Props): React.ReactElement {
  const supabase = useMemo(() => createClient(), [])
  const pathname = usePathname()
  const ready = initialState !== null
  const [states, setStates] = useState<ReadonlyMap<string, Record<string, unknown>>>(
    () => new Map((initialState ?? []).map((row) => [row.key, row.value]))
  )
  const [active, setActive] = useState<ActiveTour | null>(null)
  const activeRef = useRef<ActiveTour | null>(null)
  activeRef.current = active

  const registrations = useRef(new Map<number, Registration>())
  const [registrationsVersion, bumpRegistrations] = useReducer((count: number) => count + 1, 0)
  const nextOrder = useRef(0)
  // The tours this page visit has already had its chance with. When one starts
  // by itself, every tour offered at that moment joins the set, so a visit
  // gets one automatic tour; a tour the page offers later (the draft tab
  // moving from setup to drafting) is new and gets its own chance. A tour
  // that couldn't start (its elements never showed) joins alone, so the
  // page's next tour gets a turn. Leaving the path starts a new visit.
  const visit = useRef<{ pathname: string; tried: Set<string> }>({ pathname: '', tried: new Set() })

  const tourState = useCallback(
    (id: string) => states.get(tourKey(id)) as TourState | undefined,
    [states]
  )
  const enabled = toursEnabled(states.get(TOURS_PREF_KEY))

  const isSeen = useCallback(
    (id: string) => {
      const tour = getTour(id)
      return tour ? isTourSeen(tourState(id), tour) : true
    },
    [tourState]
  )

  const applyState = useCallback((key: string, value: Record<string, unknown> | null) => {
    setStates((current) => {
      const next = new Map(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  }, [])

  const record = useCallback(
    async (tour: TourDefinition, status: TourOutcome) => {
      const key = tourKey(tour.id)
      // Shown at once; replaced by what the server kept, which may differ
      // (a second snooze becomes a dismissal, a stale version changes nothing).
      applyState(key, { v: tour.version, status })
      const { data, error } = await supabase.rpc('record_tour_outcome', {
        p_tour_id: tour.id,
        p_version: tour.version,
        p_status: status,
      })
      if (error) {
        captureException(error, { tags: { source: 'tours' }, extra: { tour_id: tour.id } })
        return
      }
      applyState(key, data as Record<string, unknown>)
      if (status === 'completed') trackEvent('tour_completed', { tour_id: tour.id })
      if (status === 'dismissed') trackEvent('tour_dismissed', { tour_id: tour.id })
    },
    [supabase, applyState]
  )

  /** Close the tour on screen, recording how it ended; null records nothing. */
  const end = useCallback(
    (status: TourOutcome | null) => {
      const current = activeRef.current
      if (!current) return
      activeRef.current = null
      setActive(null)
      if (status) void record(current.tour, status)
    },
    [record]
  )

  const launch = useCallback(async (id: TourId, ctx: TourContext, automatic: boolean, cancelled: () => boolean) => {
    const tour = getTour(id)
    if (!tour) return false
    const steps = await planSteps(applicableSteps(tour, ctx), automatic, cancelled)
    if (!steps || steps.length === 0 || cancelled() || activeRef.current) return false
    const next: ActiveTour = { tour, steps, index: 0, automatic }
    activeRef.current = next
    setActive(next)
    trackEvent('tour_started', { tour_id: tour.id, trigger: automatic ? 'auto' : 'manual' })
    return true
  }, [])

  const register = useCallback((id: TourId, ctx: TourContext) => {
    const order = nextOrder.current++
    registrations.current.set(order, { order, id, ctx })
    bumpRegistrations()
    return {
      update: (nextCtx: TourContext) => {
        registrations.current.set(order, { order, id, ctx: nextCtx })
        bumpRegistrations()
      },
      unregister: () => {
        registrations.current.delete(order)
        bumpRegistrations()
        // The page that offered the tour is gone (navigation, a phase change,
        // a closed dialog). Unless the same tour is still registered by
        // something else on screen, end it: on the last step that is usually
        // the user doing what the step asked (Start draft), so it counts as
        // finished; earlier, it's "not now" so the tour isn't lost.
        const stillOffered = [...registrations.current.values()].some((registration) => registration.id === id)
        const current = activeRef.current
        if (current?.tour.id === id && !stillOffered) end(current.index === current.steps.length - 1 ? 'completed' : 'snoozed')
      },
    }
  }, [end])

  const pageTours = useMemo(() => {
    void registrationsVersion
    const ids = [...registrations.current.values()]
      .filter((registration) => applicableSteps(getTour(registration.id)!, registration.ctx).length > 0)
      .map((registration) => registration.id)
    return [...new Set(ids)]
  }, [registrationsVersion])

  const start = useCallback(
    async (id: TourId) => {
      const registration = [...registrations.current.values()].find((candidate) => candidate.id === id)
      // Replaced by the tour the user asked for, not turned down: record nothing.
      if (activeRef.current) end(null)
      return launch(id, registration?.ctx ?? {}, false, () => false)
    },
    [launch, end]
  )

  // Start the page's tour by itself when one applies and hasn't been seen.
  useEffect(() => {
    void registrationsVersion
    if (!ready || !enabled || active || automationOptedOut()) return
    if (visit.current.pathname !== pathname) visit.current = { pathname, tried: new Set() }
    const tried = visit.current.tried
    const offered = [...registrations.current.values()]
    const candidates = offered
      .filter((registration) => !tried.has(registration.id))
      .map((registration) => ({ tour: getTour(registration.id)!, ctx: registration.ctx, order: registration.order }))
    const outcomes = new Map(
      TOUR_LIST.map((tour) => [tour.id, tourState(tour.id)] as const).filter((entry): entry is [string, TourState] => entry[1] !== undefined)
    )
    const pick = pickAutoStart(candidates, outcomes, new Date())
    if (!pick) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void launch(pick.tour.id as TourId, pick.ctx, true, () => cancelled).then((started) => {
        if (started) {
          for (const registration of offered) tried.add(registration.id)
        } else if (!cancelled && !activeRef.current) {
          tried.add(pick.tour.id)
          bumpRegistrations()
        }
      })
    }, AUTO_START_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ready, enabled, active, pathname, registrationsVersion, tourState, launch])

  const reset = useCallback(
    async (id?: TourId) => {
      let query = supabase.from('user_ui_state').delete().eq('user_id', userId)
      query = id ? query.eq('key', tourKey(id)) : query.like('key', `${TOUR_KEY_PREFIX}%`)
      const { error } = await query
      if (error) throw new Error('Couldn’t reset your tours. Try again.')
      const keys = id ? [tourKey(id)] : [...states.keys()].filter((key) => key.startsWith(TOUR_KEY_PREFIX))
      for (const key of keys) applyState(key, null)
      if (id) visit.current.tried.delete(id)
      else visit.current.tried.clear()
    },
    [supabase, userId, states, applyState]
  )

  const setEnabled = useCallback(
    async (next: boolean) => {
      const value = { enabled: next }
      const { error } = await supabase
        .from('user_ui_state')
        .upsert({ user_id: userId, key: TOURS_PREF_KEY, value }, { onConflict: 'user_id,key' })
      if (error) throw new Error('Couldn’t save your tour setting. Try again.')
      applyState(TOURS_PREF_KEY, value)
    },
    [supabase, userId, applyState]
  )

  const value = useMemo<ToursContextValue>(
    () => ({ ready, enabled, tourState, isSeen, pageTours, start, reset, setEnabled, register }),
    [ready, enabled, tourState, isSeen, pageTours, start, reset, setEnabled, register]
  )

  return (
    <ToursContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          key={active.tour.id}
          tour={active}
          onBack={() => setActive((current) => (current ? { ...current, index: Math.max(0, current.index - 1) } : null))}
          onNext={() => {
            if (active.index >= active.steps.length - 1) end('completed')
            else setActive((current) => (current ? { ...current, index: current.index + 1 } : null))
          }}
          onNotNow={() => end('snoozed')}
          onDontShowAgain={() => end('dismissed')}
          onTurnOffTours={() => {
            end('dismissed')
            void setEnabled(false)
              .then(() => toast.success('Tours turned off. You can turn them back on in Settings.'))
              .catch((error: unknown) => {
                captureException(error, { tags: { source: 'tours' } })
                toast.error('Couldn’t turn tours off. Try again from Settings.')
              })
          }}
        />
      )}
    </ToursContext.Provider>
  )
}
