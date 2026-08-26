'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'
import {
  DEFAULT_EXPIRY_HOURS,
  MAX_EXPIRY_DAYS,
  MIN_EXPIRY_MINUTES,
} from '@/utils/tradeExpiry'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader } from './shared'

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
      {/* No locked state, unlike the draft-time sections: trading runs through
          the active season, and a commissioner tuning a veto window or calling
          a deadline mid-season is the normal case rather than an escape hatch. */}
      <SectionHeader
        icon={ArrowLeftRight}
        title="Trade Settings"
        description="Deadline, commissioner review, and how long offers stand"
      />

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Trading on/off */}
          <div className="flex items-start gap-3">
            <div className="pt-0.5">
              <input
                type="checkbox"
                id="trades_enabled"
                checked={tradesEnabled}
                onChange={(e) => setTradesEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
              />
            </div>
            <div>
              <label
                htmlFor="trades_enabled"
                className="block text-sm font-medium text-foreground cursor-pointer"
              >
                Allow Trading
              </label>
              <p className="text-xs text-foreground-muted mt-1">
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
              className="block text-sm font-medium text-foreground-secondary mb-2"
            >
              Trade Deadline
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                id="trade_deadline"
                value={tradeDeadline}
                onChange={(e) => setTradeDeadline(e.target.value)}
                className="input w-48"
                aria-describedby="trade_deadline_help"
              />
              {tradeDeadline && (
                <button
                  type="button"
                  onClick={() => setTradeDeadline('')}
                  className="btn btn-ghost px-3 py-1 text-sm"
                >
                  Clear
                </button>
              )}
            </div>
            <p id="trade_deadline_help" className="text-xs text-foreground-muted mt-1.5">
              {tradeDeadline
                ? 'The last day trades can happen, inclusive. An offer running past it is cut short to it.'
                : 'No deadline — trades stay open all season.'}
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
                  className="w-4 h-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-0 focus:ring-2 cursor-pointer"
                />
              </div>
              <div>
                <label
                  htmlFor="trade_review_enabled"
                  className="block text-sm font-medium text-foreground cursor-pointer"
                >
                  Commissioner Review
                </label>
                <p className="text-xs text-foreground-muted mt-1">
                  {reviewEnabled
                    ? 'An accepted trade waits before it executes, so you can veto or approve it early.'
                    : 'An accepted trade executes on the next processing run with no review.'}
                </p>
              </div>
            </div>

            {reviewEnabled && (
              <div>
                <label
                  htmlFor="trade_veto_hours"
                  className="block text-sm font-medium text-foreground-secondary mb-2"
                >
                  Review Window
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    id="trade_veto_hours"
                    value={vetoHours}
                    onChange={(e) => setVetoHours(parseInt(e.target.value, 10) || MIN_VETO_HOURS)}
                    min={MIN_VETO_HOURS}
                    max={MAX_VETO_HOURS}
                    className={`input w-24 ${vetoOutOfRange ? 'border-error focus:border-error' : ''}`}
                  />
                  <span className="text-sm text-foreground-secondary">hours</span>
                </div>
                <p className="text-xs text-foreground-muted mt-1.5">
                  {vetoHours === 0
                    ? 'No waiting — an accepted trade executes on the next run (0 turns the window off).'
                    : `How long you have to veto after both teams agree (${MIN_VETO_HOURS}-${MAX_VETO_HOURS}h).`}
                </p>
                {vetoOutOfRange && (
                  <p className="text-xs text-error mt-1">
                    Must be between {MIN_VETO_HOURS} and {MAX_VETO_HOURS} hours
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Offer windows. A different clock from both of the above: how long
              an UNANSWERED offer stands before it lapses. */}
          <div className="pt-2 border-t border-border">
            <h3 className="text-sm font-medium text-foreground mt-4">Offer Windows</h3>
            <p className="text-xs text-foreground-muted mt-1">
              How long an offer can stand before it expires unanswered. Leave a field blank to use
              the app default.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div>
                <label
                  htmlFor="expiry_default_hours"
                  className="block text-sm font-medium text-foreground-secondary mb-2"
                >
                  Default
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    id="expiry_default_hours"
                    value={defaultHours}
                    onChange={(e) => setDefaultHours(e.target.value)}
                    placeholder={String(DEFAULT_EXPIRY_HOURS)}
                    min={MIN_DEFAULT_HOURS}
                    max={MAX_DEFAULT_HOURS}
                    className={`input w-24 ${defaultOutOfRange ? 'border-error focus:border-error' : ''}`}
                  />
                  <span className="text-sm text-foreground-secondary">hours</span>
                </div>
                <p className="text-xs text-foreground-muted mt-1.5">
                  Preselected in the picker ({MIN_DEFAULT_HOURS}-{MAX_DEFAULT_HOURS}h)
                </p>
                {defaultOutOfRange && (
                  <p className="text-xs text-error mt-1">
                    Must be a whole number between {MIN_DEFAULT_HOURS} and {MAX_DEFAULT_HOURS}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="expiry_min_hours"
                  className="block text-sm font-medium text-foreground-secondary mb-2"
                >
                  Minimum
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    id="expiry_min_hours"
                    value={minHours}
                    onChange={(e) => setMinHours(e.target.value)}
                    placeholder={String(APP_DEFAULT_MIN_HOURS)}
                    min={MIN_MIN_HOURS}
                    max={MAX_MIN_HOURS}
                    className={`input w-24 ${minOutOfRange ? 'border-error focus:border-error' : ''}`}
                  />
                  <span className="text-sm text-foreground-secondary">hours</span>
                </div>
                <p className="text-xs text-foreground-muted mt-1.5">
                  Shortest window allowed ({MIN_MIN_HOURS}-{MAX_MIN_HOURS}h)
                </p>
                {minOutOfRange && (
                  <p className="text-xs text-error mt-1">
                    Must be a whole number between {MIN_MIN_HOURS} and {MAX_MIN_HOURS}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="expiry_max_days"
                  className="block text-sm font-medium text-foreground-secondary mb-2"
                >
                  Maximum
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    id="expiry_max_days"
                    value={maxDays}
                    onChange={(e) => setMaxDays(e.target.value)}
                    placeholder={String(MAX_EXPIRY_DAYS)}
                    min={MIN_MAX_DAYS}
                    max={MAX_MAX_DAYS}
                    className={`input w-24 ${maxOutOfRange ? 'border-error focus:border-error' : ''}`}
                  />
                  <span className="text-sm text-foreground-secondary">days</span>
                </div>
                <p className="text-xs text-foreground-muted mt-1.5">
                  Longest window allowed ({MIN_MAX_DAYS}-{MAX_MAX_DAYS}d)
                </p>
                {maxOutOfRange && (
                  <p className="text-xs text-error mt-1">
                    Must be a whole number between {MIN_MAX_DAYS} and {MAX_MAX_DAYS}
                  </p>
                )}
              </div>
            </div>

            {/* Narrowing one field alone is the mistake this catches, and the
                blank fields make it invisible -- hence the effective numbers. */}
            {boundsOutOfOrder && (
              <p role="alert" className="text-xs text-error mt-3">
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
            'Save Changes'
          )}
        </button>
      </form>
    </section>
  )
}
