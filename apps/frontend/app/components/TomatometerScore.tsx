/**
 * The Tomatometer is the only critic score that affects fantasy points, so it is
 * shown as a single readout rather than one badge among several.
 *
 * Colour encodes the fantasy consequence, not the RT brand: 60% is both RT's
 * Fresh line and the scoring baseline (points = RT - 60), so gold means the
 * movie is earning points and crimson means it is losing them. The tier labels
 * match the scoring curve documented on the help page.
 */

interface Props {
  /** The Tomatometer, 0-100. Null when the movie has no RT score yet. */
  score: number | null
  size?: 'sm' | 'md'
  /** Show the break-even meter. Only worth the space where movies are compared. */
  showMeter?: boolean
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
  sm: { pill: 'gap-1 px-1.5 py-0.5 text-xs', icon: 'w-3 h-3', label: 'text-[10px]' },
  md: { pill: 'gap-1.5 px-2.5 py-1 text-sm', icon: 'w-4 h-4', label: 'text-[11px]' },
} as const

function getTier(score: number) {
  if (score >= 90) return { key: 'club' as const, label: '90% Club', fill: 'bg-gold' }
  if (score >= BREAK_EVEN) return { key: 'fresh' as const, label: 'Fresh', fill: 'bg-gold/70' }
  return { key: 'rotten' as const, label: 'Rotten', fill: 'bg-crimson' }
}

function TomatoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <rect x="9.4" y="3.4" width="1.2" height="2.8" rx="0.6" opacity="0.6" />
      <path
        d="M9.9 6.4C8.9 5.2 7.6 4.5 6.1 4.4c.2 1.4 1 2.5 2.2 3.2.5-.5 1-.9 1.6-1.2Zm.2 0c1-1.2 2.3-1.9 3.8-2-.2 1.4-1 2.5-2.2 3.2-.5-.5-1-.9-1.6-1.2Z"
        opacity="0.6"
      />
      <ellipse cx="10" cy="12.3" rx="6.6" ry="5.9" />
    </svg>
  )
}

export default function TomatometerScore({
  score,
  size = 'md',
  showMeter = false,
  showTier = true,
  className = '',
}: Props) {
  const sizing = SIZE_STYLES[size]

  if (score == null) {
    return (
      <span
        className={`inline-flex items-center rounded-lg border font-semibold ${TIER_STYLES.pending} ${sizing.pill} ${className}`}
      >
        <TomatoIcon className={sizing.icon} />
        Not rated yet
      </span>
    )
  }

  const rounded = Math.round(score)
  const tier = getTier(rounded)

  const pill = (
    <span
      className={`inline-flex items-center rounded-lg border font-semibold ${TIER_STYLES[tier.key]} ${sizing.pill}`}
      aria-label={`Tomatometer ${rounded} percent, ${tier.label}`}
    >
      <TomatoIcon className={sizing.icon} />
      {rounded}%
      {showTier && (
        <span className={`font-medium uppercase tracking-wide ${sizing.label}`}>{tier.label}</span>
      )}
    </span>
  )

  if (!showMeter) return <span className={className}>{pill}</span>

  // The tick marks break-even. The rule itself is stated once per team in the
  // standings legend, so it is not repeated under every movie.
  return (
    <div className={`flex flex-col items-start gap-1.5 ${className}`}>
      {pill}
      <div
        className="relative h-1.5 w-full max-w-[220px] rounded-full bg-elevated border border-border/60"
        aria-hidden="true"
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${tier.fill}`}
          style={{ width: `${Math.min(Math.max(rounded, 0), 100)}%` }}
        />
        <div
          className="absolute -inset-y-0.5 w-px bg-foreground-muted"
          style={{ left: `${BREAK_EVEN}%` }}
          title={`${BREAK_EVEN}% is break-even`}
        />
      </div>
    </div>
  )
}
