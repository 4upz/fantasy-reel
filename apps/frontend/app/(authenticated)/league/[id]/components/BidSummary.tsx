import type { ReactNode } from 'react'
import MoviePoster from '@/app/components/MoviePoster'
import { DollarSign } from 'lucide-react'

/** @design-system League */
export function BidAmountDisplay({ amount }: { amount: number }) {
  return (
    <div className="type-number flex items-center gap-1.5 bid-amount-display">
      <DollarSign className="w-5 h-5" aria-hidden="true" />
      <span>{amount}</span>
    </div>
  )
}

/** Movie identity and bid details without cancellation or counterbid behavior. */
/** @design-system League */
export default function BidSummary({
  title,
  posterUrl,
  releaseDate,
  children,
  focus,
}: {
  title: string
  posterUrl?: string | null
  releaseDate?: string
  children: ReactNode
  focus?: string
}) {
  return (
    <>
      <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-soft">
        <MoviePoster
          src={posterUrl}
          alt={title}
          sizes="64px"
          posterSize="w185"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div data-preview-focus={focus} className={focus ? 'w-fit max-w-full' : undefined}>
          <h4 className="type-row-title text-foreground truncate">{title}</h4>
          {releaseDate && (
            <p className="type-body-sm text-foreground-secondary mt-0.5">
              {new Date(releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
          {children}
        </div>
      </div>
    </>
  )
}
