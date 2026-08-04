'use client'

import { useId } from 'react'

/**
 * The Tomatometer is the only critic score that affects fantasy points, so it is
 * shown as a single readout rather than one badge among several.
 *
 * The tomato mark doubles as the gauge - it fills to the Tomatometer, so a solid
 * tomato is a movie carrying the team and a hollow one is a movie dragging it
 * down. That keeps the "how good" reading in a mark the card already carries
 * instead of adding a separate bar next to the score.
 *
 * Colour encodes the fantasy consequence, not the RT brand: 60% is both RT's
 * Fresh line and the scoring baseline (points = RT - 60), so gold means the
 * movie is earning points and crimson means it is losing them. The tier labels
 * match the scoring curve documented on the help page.
 */

interface Props {
  /** The Tomatometer, 0-100. Null when the movie has no RT score yet. */
  score: number | null
  size?: 'sm' | 'md' | 'lg'
  /** Show the Fresh/Rotten tier. Drop it where the surface is too narrow to fit it. */
  showTier?: boolean
  className?: string
}

/** Points are RT - 60, so 60 is where a movie starts earning instead of losing. */
const BREAK_EVEN = 60

const TIER_STYLES = {
  club: 'bg-gold/15 border-gold/40 text-gold',
  fresh: 'bg-gold/10 border-gold/25 text-gold/90',
  rotten: 'bg-crimson/15 border-crimson/40 text-crimson',
  pending: 'bg-elevated border-border text-foreground-muted',
} as const

const SIZE_STYLES = {
  sm: { pill: 'gap-1 px-1.5 py-0.5 text-xs', mark: 'w-3.5 h-3.5', label: 'text-[10px]' },
  md: { pill: 'gap-1.5 px-2.5 py-1 text-sm', mark: 'w-4 h-4', label: 'text-[11px]' },
  lg: { pill: 'gap-2 px-3 py-1.5 text-base', mark: 'w-6 h-6', label: 'text-[11px]' },
} as const

function getTier(score: number) {
  if (score >= 90) return { key: 'club' as const, label: '90% Club' }
  if (score >= BREAK_EVEN) return { key: 'fresh' as const, label: 'Fresh' }
  return { key: 'rotten' as const, label: 'Rotten' }
}

// Body of the tomato in viewBox units, used to map a score onto the fill line.
const BODY_TOP = 6.4
const BODY_BOTTOM = 18.2

/**
 * A tomato whose body fills from the bottom to `fill` percent. Passing null
 * leaves the body hollow, for a movie with no Tomatometer yet.
 */
function TomatoMark({ fill, className }: { fill: number | null; className?: string }) {
  // useId can emit colons, which browsers reject inside url(#...) references.
  const clipId = `tomato-${useId().replace(/:/g, '')}`
  const fraction = Math.min(Math.max(fill ?? 0, 0), 100) / 100
  const fillTop = BODY_BOTTOM - (BODY_BOTTOM - BODY_TOP) * fraction

  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y={fillTop} width="20" height={BODY_BOTTOM - fillTop} />
        </clipPath>
      </defs>
      {/* Stem and leaves stay solid so the mark still reads as a tomato when empty */}
      <g fill="currentColor" opacity="0.55">
        <rect x="9.4" y="3.4" width="1.2" height="2.8" rx="0.6" />
        <path d="M9.9 6.4C8.9 5.2 7.6 4.5 6.1 4.4c.2 1.4 1 2.5 2.2 3.2.5-.5 1-.9 1.6-1.2Zm.2 0c1-1.2 2.3-1.9 3.8-2-.2 1.4-1 2.5-2.2 3.2-.5-.5-1-.9-1.6-1.2Z" />
      </g>
      <ellipse
        cx="10"
        cy="12.3"
        rx="6.6"
        ry="5.9"
        fill="currentColor"
        opacity="0.18"
      />
      {fill != null && (
        <ellipse cx="10" cy="12.3" rx="6.6" ry="5.9" fill="currentColor" clipPath={`url(#${clipId})`} />
      )}
      <ellipse
        cx="10"
        cy="12.3"
        rx="6.6"
        ry="5.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.7"
      />
    </svg>
  )
}

export default function TomatometerScore({
  score,
  size = 'md',
  showTier = true,
  className = '',
}: Props) {
  const sizing = SIZE_STYLES[size]

  if (score == null) {
    return (
      <span
        className={`inline-flex items-center rounded-lg border font-semibold ${TIER_STYLES.pending} ${sizing.pill} ${className}`}
      >
        <TomatoMark fill={null} className={sizing.mark} />
        Not rated yet
      </span>
    )
  }

  const rounded = Math.round(score)
  const tier = getTier(rounded)

  return (
    <span
      className={`inline-flex items-center rounded-lg border font-semibold ${TIER_STYLES[tier.key]} ${sizing.pill} ${className}`}
      aria-label={`Tomatometer ${rounded} percent, ${tier.label}`}
    >
      <TomatoMark fill={rounded} className={sizing.mark} />
      {rounded}%
      {showTier && (
        <span className={`font-medium uppercase tracking-wide ${sizing.label}`}>{tier.label}</span>
      )}
    </span>
  )
}
