'use client'

import type { MovieProjection } from '@/types'
import { useMovieProjection } from '@/hooks/useMovieProjections'
import {
  PROJECTION_BREAK_EVEN,
  PROJECTION_DISCLAIMER,
  RANGE_EXPLAINER,
  formatChance,
  formatProjectionDate,
  projectedPointsFor,
  projectionBarSegments,
  projectionChipState,
  projectionFactors,
  projectionTone,
  type ProjectionChipState,
  type ProjectionTone,
} from '@/utils/projections'
import { formatSignedPoints, pointsTone } from '@/utils/scoring'
import BetaBadge from './BetaBadge'

interface Props {
  projection: MovieProjection
  /** Shown on a counterpick, whose holder scores the negation. */
  counterpick?: boolean
  /** `panel` beside the franchise history in a movie dialog; `compact` inside the chip's popover. */
  variant?: 'panel' | 'compact'
  /** Id for the heading, so the popover or sheet hosting it is named by it. */
  headingId?: string
  className?: string
}

const TONE_TEXT: Record<ProjectionTone, string> = {
  fresh: 'text-gold',
  rotten: 'text-crimson-text',
  uncertain: 'text-foreground',
}

/**
 * Gold steps for factors that lift the projection and crimson for those that
 * pull it down; adjacent segments differ in lightness so they read apart.
 */
const POSITIVE_FILLS = ['bg-gold', 'bg-gold/75', 'bg-gold/55']
const NEGATIVE_FILLS = ['bg-crimson', 'bg-crimson/70', 'bg-crimson/50']
const BASELINE_FILL = 'bg-foreground-muted/70'

/** The big number: the same reading as the chip, without the "Proj." prefix. */
function headline(state: ProjectionChipState, projection: MovieProjection): string {
  switch (state.kind) {
    case 'early':
      return `${state.score}%`
    case 'range':
      return `${state.low}–${state.high}%`
    case 'point':
      return `~${state.value}%`
    case 'insufficient':
      return `~${Math.round(projection.projected_rt)}%`
  }
}

/** The big number as a screen reader should say it ("~" and "–" read literally). */
function spokenHeadline(state: ProjectionChipState, projection: MovieProjection): string {
  switch (state.kind) {
    case 'early':
      return `${state.score}%`
    case 'range':
      return `${state.low} to ${state.high}%`
    case 'point':
      return `about ${state.value}%`
    case 'insufficient':
      return `about ${Math.round(projection.projected_rt)}%`
  }
}

/**
 * Why a movie projects where it does: the genre baseline, each factor's push,
 * and what the projection means in odds and points. Never repeats franchise
 * history -- `FranchiseHistoryPanel` beside it already carries that.
 */
/** @design-system Movies */
export default function ProjectionBreakdown({
  projection,
  counterpick = false,
  variant = 'panel',
  headingId,
  className = '',
}: Props) {
  const compact = variant === 'compact'
  const state = projectionChipState(projection)
  const pointEstimate = Math.round(projection.projected_rt)

  if (state.kind === 'insufficient') {
    return (
      <section
        data-testid="projection-breakdown"
        className={`${compact ? '' : 'rounded-xl border border-dashed border-gold/40 bg-surface-hover p-4'} ${className}`}
      >
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="type-row-title text-foreground">Projected Tomatometer</h3>
          <BetaBadge />
        </div>
        <p className="type-body-sm mt-2 text-foreground">Not enough history yet</p>
        <p className="type-body-sm mt-1 text-foreground-secondary">
          Too few earlier films from this movie&apos;s filmmakers and cast have scores to project it. It will
          appear as more of their work is reviewed.
        </p>
        <p className="type-meta mt-3 border-t border-border pt-3 text-foreground-secondary">{PROJECTION_DISCLAIMER}</p>
      </section>
    )
  }

  const factors = projectionFactors(projection)
  const segments = projectionBarSegments(projection.baseline_rt, factors)
  const fills = new Map<string, string>([['baseline', BASELINE_FILL]])
  let up = 0
  let down = 0
  factors.forEach((factor) => {
    fills.set(
      factor.key,
      factor.delta >= 0 ? POSITIVE_FILLS[up++ % POSITIVE_FILLS.length] : NEGATIVE_FILLS[down++ % NEGATIVE_FILLS.length]
    )
  })
  const points = projectedPointsFor(projection, counterpick)
  const [low80, high80] = projection.range80
  const updated = formatProjectionDate(projection.computed_at)

  return (
    <section
      data-testid="projection-breakdown"
      className={`flex flex-col ${compact ? 'gap-4' : 'gap-5 rounded-xl border border-dashed border-gold/40 bg-surface-hover p-4 sm:p-5'} ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="type-row-title text-foreground">
            {compact ? `Why ${state.kind === 'early' ? state.score : pointEstimate}%` : 'Projected Tomatometer'}
          </h3>
          <BetaBadge />
        </div>
        {!compact && updated && <span className="type-meta text-foreground-secondary">Updated {updated}</span>}
      </div>

      {!compact && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className={`type-number-lg ${TONE_TEXT[projectionTone(projection, state)]}`} data-testid="projection-headline">
            <span aria-hidden="true">{headline(state, projection)}</span>
            <span className="sr-only">{spokenHeadline(state, projection)}</span>
          </span>
          <span className="type-body-sm text-foreground-secondary">
            {state.kind === 'early' ? (
              <>
                Early reviews <span aria-hidden="true">·</span>
                <span className="sr-only">,</span> {state.reviews} so far
              </>
            ) : (
              <>
                Most likely <span className="type-numeric font-bold text-foreground">{pointEstimate}%</span>
              </>
            )}
            {state.kind === 'point' && state.lowConfidence && <span className="ml-2 text-warning">Low confidence</span>}
          </span>
        </div>
      )}

      <div>
        <div className="relative h-3.5 overflow-hidden rounded bg-elevated" aria-hidden="true">
          {segments.map((segment) => (
            <div
              key={segment.key}
              className={`absolute inset-y-0 ${fills.get(segment.key)} ${segment.key === 'baseline' ? '' : 'border-l border-surface-hover'}`}
              style={{ left: `${segment.start}%`, width: `${segment.width}%` }}
            />
          ))}
          <div
            className="absolute inset-y-0 border-l border-dashed border-foreground/60"
            style={{ left: `${PROJECTION_BREAK_EVEN}%` }}
          />
        </div>
        <div className="type-meta relative mt-1.5 h-4 text-foreground-secondary" aria-hidden="true">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${PROJECTION_BREAK_EVEN}%` }}>
            {PROJECTION_BREAK_EVEN}
          </span>
          <span className="absolute right-0">100</span>
        </div>
      </div>

      <ul className={`type-body-sm grid gap-x-5 gap-y-2 ${compact ? '' : 'sm:grid-cols-2'}`} aria-label="What moves this projection">
        <FactorRow fill={BASELINE_FILL} label="Genre baseline" value={String(Math.round(projection.baseline_rt))} tone="text-foreground" />
        {factors.map((factor) => (
          <FactorRow
            key={factor.key}
            fill={fills.get(factor.key)!}
            label={factor.label}
            value={formatSignedPoints(factor.delta)}
            tone={factor.delta >= 0 ? 'text-gold' : 'text-crimson-text'}
          />
        ))}
      </ul>

      <dl className={`grid grid-cols-2 gap-3 ${compact ? '' : 'sm:grid-cols-4'}`}>
        <Stat
          label="80% range"
          value={`${Math.round(low80)}–${Math.round(high80)}%`}
          spoken={`${Math.round(low80)} to ${Math.round(high80)}%`}
        />
        <Stat label="Chance rotten" value={formatChance(projection.p_rotten)} />
        <Stat label="Chance of 90%+" value={formatChance(projection.p_90)} />
        <Stat
          label={counterpick ? 'As a counterpick' : 'Expected points'}
          value={`${formatSignedPoints(points)} pts`}
          tone={pointsTone(points, { positive: 'text-gold' })}
          testId="projection-expected-points"
        />
      </dl>

      {(projection.partial || projection.includes_early_reviews) && (
        <p className="type-meta text-foreground-secondary">
          {projection.includes_early_reviews && 'Includes early reviews. '}
          {projection.partial && 'Still collecting earlier films, so this may move.'}
        </p>
      )}

      <p className="type-meta border-t border-border pt-3 text-foreground-secondary">
        {!compact && `${RANGE_EXPLAINER} `}
        {PROJECTION_DISCLAIMER}
      </p>
    </section>
  )
}

function FactorRow({ fill, label, value, tone }: { fill: string; label: string; value: string; tone: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2 text-foreground">
        <span className={`h-2 w-2 flex-none rounded-sm ${fill}`} aria-hidden="true" />
        <span className="min-w-0 break-words">{label}</span>
      </span>
      <span className={`type-numeric flex-none font-bold ${tone}`}>{value}</span>
    </li>
  )
}

function Stat({
  label,
  value,
  spoken,
  tone = 'text-foreground',
  testId,
}: {
  label: string
  value: string
  /** How to say `value` when its symbols would be read literally. */
  spoken?: string
  tone?: string
  testId?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="type-meta text-foreground-secondary">{label}</dt>
      <dd className={`type-number ${tone}`} data-testid={testId}>
        {spoken ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{spoken}</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

/**
 * The breakdown for a movie in this league, beside its franchise history.
 * Renders nothing -- no heading, no gap -- unless the league has projections
 * on and this movie has one.
 */
export function MovieProjectionPanel({
  tmdbId,
  counterpick,
  className,
}: {
  tmdbId: number
  counterpick?: boolean
  className?: string
}) {
  const projection = useMovieProjection(tmdbId)
  if (!projection) return null
  return <ProjectionBreakdown projection={projection} counterpick={counterpick} className={className} />
}
