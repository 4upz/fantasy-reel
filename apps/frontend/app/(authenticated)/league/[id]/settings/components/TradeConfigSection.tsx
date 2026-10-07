'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import {
  DEFAULT_EXPIRY_HOURS,
  MAX_EXPIRY_DAYS,
  MIN_EXPIRY_MINUTES,
} from '@/utils/tradeExpiry'
import { formatSeasonDate } from '@/utils/seasons'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage, NumberField } from './shared'

interface Props {
  league: League
  onUpdate: (league: League) => void
}

// Constraints. Mirrors update-league's handleUpdateTradeConfig, which mirrors
// the CHECKs in 20260827120000 -- three copies, so keep the numbers together.
const MIN_VETO_HOURS = 0
const MAX_VETO_HOURS = 168
const MIN_DEFAULT_HOURS = 1
const MAX_DEFAULT_HOURS = 2160
const MIN_MIN_HOURS = 1
const MAX_MIN_HOURS = 168
const MIN_MAX_DAYS = 1
const MAX_MAX_DAYS = 90

/** The app-level fallbacks, as the placeholders that stand in for "not set". */
const APP_DEFAULT_MIN_HOURS = MIN_EXPIRY_MINUTES / 60

interface UpdateTradeConfigResponse {
  league: League
  message: string
}

/**
 * The three expiry bounds are held as raw input strings rather than numbers.
 *
 * Empty means "not set", which the row stores as NULL and the app reads as its
 * own default -- so the field has to tell empty apart from 0, which a number
 * state cannot. It also stops a half-typed value being rewritten under the
 * cursor on its way through parseInt.
 */
function toInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

/** `''` -> null (use the app default), otherwise the parsed integer. */
function parseNullable(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/** Out of range, or not a whole number. Empty is always fine -- it means NULL. */
function outOfRange(value: string, min: number, max: number): boolean {
  const parsed = parseNullable(value)
  if (parsed === null) return false
  return !Number.isInteger(parsed) || parsed < min || parsed > max
}

export default function TradeConfigSection({ league, onUpdate }: Props): React.ReactElement {
  const [tradesEnabled, setTradesEnabled] = useState(league.trades_enabled)
  const [tradeDeadline, setTradeDeadline] = useState(league.trade_deadline ?? '')
  const [reviewEnabled, setReviewEnabled] = useState(league.trade_review_enabled)
  const [vetoHours, setVetoHours] = useState(league.trade_veto_hours)
  const [defaultHours, setDefaultHours] = useState(toInput(league.trade_offer_expiry_default_hours))
  const [minHours, setMinHours] = useState(toInput(league.trade_offer_expiry_min_hours))
  const [maxDays, setMaxDays] = useState(toInput(league.trade_offer_expiry_max_days))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const deadlineInputRef = useRef<HTMLInputElement>(null)
  const isCompleted = league.status === 'completed'

  const hasChanges =
    tradesEnabled !== league.trades_enabled ||
    tradeDeadline !== (league.trade_deadline ?? '') ||
    reviewEnabled !== league.trade_review_enabled ||
    vetoHours !== league.trade_veto_hours ||
    parseNullable(defaultHours) !== (league.trade_offer_expiry_default_hours ?? null) ||
    parseNullable(minHours) !== (league.trade_offer_expiry_min_hours ?? null) ||
    parseNullable(maxDays) !== (league.trade_offer_expiry_max_days ?? null)

  // Validation
  const vetoOutOfRange =
    !Number.isInteger(vetoHours) || vetoHours < MIN_VETO_HOURS || vetoHours > MAX_VETO_HOURS
  const defaultOutOfRange = outOfRange(defaultHours, MIN_DEFAULT_HOURS, MAX_DEFAULT_HOURS)
  const minOutOfRange = outOfRange(minHours, MIN_MIN_HOURS, MAX_MIN_HOURS)
  const maxOutOfRange = outOfRange(maxDays, MIN_MAX_DAYS, MAX_MAX_DAYS)

  // The bounds the league will HAVE, with the app defaults standing in for
  // whatever was left blank -- the same resolution the server and the CHECK
  // both do, because narrowing one field alone is what breaks the ordering.
  const effectiveDefault = parseNullable(defaultHours) ?? DEFAULT_EXPIRY_HOURS
  const effectiveMin = parseNullable(minHours) ?? APP_DEFAULT_MIN_HOURS
  const effectiveMax = parseNullable(maxDays) ?? MAX_EXPIRY_DAYS
  const boundsOutOfOrder =
    !defaultOutOfRange &&
    !minOutOfRange &&
    !maxOutOfRange &&
    (effectiveMin > effectiveDefault || effectiveDefault > effectiveMax * 24)

  const hasValidationError =
    vetoOutOfRange || defaultOutOfRange || minOutOfRange || maxOutOfRange || boundsOutOfOrder

  const isSubmitDisabled = isSubmitting || !hasChanges || hasValidationError

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (league.status === 'completed') return
    setIsSubmitting(true)

    const { data, error } = await callEdgeFunction<UpdateTradeConfigResponse>('update-league', {
      body: {
        action: 'update_trade_config',
        league_id: league.id,
        trades_enabled: tradesEnabled,
        // '' clears the season deadline; the column is a bare DATE, which is
        // exactly what <input type="date"> yields.
        trade_deadline: tradeDeadline || null,
        trade_review_enabled: reviewEnabled,
        trade_veto_hours: vetoHours,
        trade_offer_expiry_default_hours: parseNullable(defaultHours),
        trade_offer_expiry_min_hours: parseNullable(minHours),
        trade_offer_expiry_max_days: parseNullable(maxDays),
      },
    })

    setIsSubmitting(false)

    if (error) {
      toast.error(error)
      return
    }

    if (data?.league) {
      onUpdate(data.league)
      toast.success('Trade settings updated')
    }
  }

  return (
    <section className="card p-6">
      {/* Trade settings stay editable until the season completes. */}
      <SectionHeader
        icon={ArrowLeftRight}
        title="Trade Settings"
        description="Deadline, commissioner review, and how long offers stand"
      />

      {/* Says why every control below is disabled, instead of leaving it to be guessed. */}
      {isCompleted && (
        <div className="mb-6">
          <LockedMessage message="This season is complete, so its trade settings are final." />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={isCompleted}>
          <div className="space-y-6">
            {/* Trading on/off */}
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                <input
                  type="checkbox"
                  id="trades_enabled"
                  checked={tradesEnabled}
                  onChange={(e) => setTradesEnabled(e.target.checked)}
                  aria-describedby="trades_enabled_help"
                  className="w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
                />
              </div>
              <div>
                <label
                  htmlFor="trades_enabled"
                  className="type-label block text-foreground cursor-pointer"
                >
                  Allow trading
                </label>
                <p id="trades_enabled_help" className="type-meta text-foreground-secondary mt-1">
                  {tradesEnabled
                    ? 'Teams can propose trades to each other while the league is active.'
                    : 'Trading is off — new offers are refused, and offers already open cannot be accepted.'}
                </p>
              </div>
            </div>

            {/* Season deadline */}
            <div>
              <label
                htmlFor="trade_deadline"
                className="type-label block text-foreground-secondary mb-2"
              >
                Trade deadline
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={deadlineInputRef}
                  type="date"
                  id="trade_deadline"
                  value={tradeDeadline}
                  onChange={(e) => setTradeDeadline(e.target.value)}
                  max={league.season_end}
                  className="input w-48"
                  aria-describedby="trade_deadline_help"
                />
                {tradeDeadline && (
                  <button
                    type="button"
                    onClick={() => {
                      setTradeDeadline('')
                      // This button disappears once the deadline is empty.
                      deadlineInputRef.current?.focus()
                    }}
                    className="type-control btn btn-ghost px-3 py-1"
                    aria-label="Clear trade deadline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p id="trade_deadline_help" className="type-meta text-foreground-secondary mt-1.5">
                {tradeDeadline
                  ? 'The last day trades can happen, inclusive. An offer running past it is cut short to it.'
                  : `No deadline — trades stay open until the season ends on ${formatSeasonDate(league.season_end)}.`}
              </p>
            </div>

            {/* Commissioner review */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <input
                    type="checkbox"
                    id="trade_review_enabled"
                    checked={reviewEnabled}
                    onChange={(e) => setReviewEnabled(e.target.checked)}
                    aria-describedby="trade_review_enabled_help"
                    className="w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
                  />
                </div>
                <div>
                  <label
                    htmlFor="trade_review_enabled"
                    className="type-label block text-foreground cursor-pointer"
                  >
                    Commissioner review
                  </label>
                  <p id="trade_review_enabled_help" className="type-meta text-foreground-secondary mt-1">
                    {reviewEnabled
                      ? 'An accepted trade waits before it executes, so you can veto or approve it early.'
                      : 'An accepted trade executes on the next processing run with no review.'}
                  </p>
                </div>
              </div>

              {reviewEnabled && (
                <NumberField
                  id="trade_veto_hours"
                  label="Review window"
                  unit="hours"
                  value={vetoHours}
                  onChange={(raw) => setVetoHours(parseInt(raw, 10) || MIN_VETO_HOURS)}
                  min={MIN_VETO_HOURS}
                  max={MAX_VETO_HOURS}
                  help={vetoHours === 0
                    ? 'No waiting — an accepted trade executes on the next run (0 turns the window off).'
                    : `How long you have to veto after both teams agree (${MIN_VETO_HOURS}-${MAX_VETO_HOURS}h).`}
                  error={vetoOutOfRange ? `Must be between ${MIN_VETO_HOURS} and ${MAX_VETO_HOURS} hours` : null}
                />
              )}
            </div>

            {/* Offer windows. A different clock from both of the above: how long
                an UNANSWERED offer stands before it lapses. */}
            <div
              className="pt-2 border-t border-border"
              role="group"
              aria-labelledby="offer_windows_heading"
              aria-describedby="offer_windows_help"
            >
              <h4 id="offer_windows_heading" className="type-label text-foreground mt-4">Offer windows</h4>
              <p id="offer_windows_help" className="type-meta text-foreground-secondary mt-1">
                How long an offer can stand before it expires unanswered. Leave a field blank to use
                the app default.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <NumberField
                  id="expiry_default_hours"
                  label={<>Default<span className="sr-only"> offer window</span></>}
                  unit="hours"
                  value={defaultHours}
                  onChange={setDefaultHours}
                  placeholder={String(DEFAULT_EXPIRY_HOURS)}
                  min={MIN_DEFAULT_HOURS}
                  max={MAX_DEFAULT_HOURS}
                  help={`Preselected in the picker (${MIN_DEFAULT_HOURS}-${MAX_DEFAULT_HOURS}h)`}
                  error={defaultOutOfRange
                    ? `Must be a whole number between ${MIN_DEFAULT_HOURS} and ${MAX_DEFAULT_HOURS}`
                    : null}
                />

                <NumberField
                  id="expiry_min_hours"
                  label={<>Minimum<span className="sr-only"> offer window</span></>}
                  unit="hours"
                  value={minHours}
                  onChange={setMinHours}
                  placeholder={String(APP_DEFAULT_MIN_HOURS)}
                  min={MIN_MIN_HOURS}
                  max={MAX_MIN_HOURS}
                  help={`Shortest window allowed (${MIN_MIN_HOURS}-${MAX_MIN_HOURS}h)`}
                  error={minOutOfRange
                    ? `Must be a whole number between ${MIN_MIN_HOURS} and ${MAX_MIN_HOURS}`
                    : null}
                />

                <NumberField
                  id="expiry_max_days"
                  label={<>Maximum<span className="sr-only"> offer window</span></>}
                  unit="days"
                  value={maxDays}
                  onChange={setMaxDays}
                  placeholder={String(MAX_EXPIRY_DAYS)}
                  min={MIN_MAX_DAYS}
                  max={MAX_MAX_DAYS}
                  help={`Longest window allowed (${MIN_MAX_DAYS}-${MAX_MAX_DAYS}d)`}
                  error={maxOutOfRange
                    ? `Must be a whole number between ${MIN_MAX_DAYS} and ${MAX_MAX_DAYS}`
                    : null}
                />
              </div>

              {/* Narrowing one field alone is the mistake this catches, and the
                  blank fields make it invisible -- hence the effective numbers. */}
              {boundsOutOfOrder && (
                <p role="alert" className="type-meta text-error mt-3">
                  The default offer window ({effectiveDefault} hours) must be between the minimum (
                  {effectiveMin} hours) and the maximum ({effectiveMax} days).
                </p>
              )}
            </div>
          </div>

          <button type="submit" disabled={isSubmitDisabled} className="btn btn-primary mt-6">
            {isSubmitting ? (
              <>
                <ButtonSpinner />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </fieldset>
      </form>
    </section>
  )
}
