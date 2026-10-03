import { Lock } from 'lucide-react'

interface Props {
  /** What follows from the lock, e.g. "can't be traded". Omit where space is tight. */
  children?: React.ReactNode
  className?: string
}

/**
 * Why a movie can't be chosen: it already has a score, and a scored movie is
 * locked against bids and trades (see isScoreLocked). Text, not just the icon,
 * so the reason survives without colour or a tooltip.
 */
export default function ScoreLockLabel({ children, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center gap-1 text-foreground-secondary ${className}`} data-testid="score-lock-label">
      <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>Already scored{children && <> — {children}</>}</span>
    </span>
  )
}
