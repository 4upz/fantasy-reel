/**
 * Marks a projected score as Beta. Built into every projection surface rather
 * than placed beside it, so no projection is ever shown without it.
 */
/** @design-system Movies */
export default function BetaBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`type-meta inline-flex flex-none items-center rounded-full bg-info-bg px-1.5 font-semibold uppercase tracking-[0.06em] text-info ${className}`}
      data-testid="beta-badge"
    >
      Beta
    </span>
  )
}
