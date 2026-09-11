import type { ReactNode } from 'react'
import Image from 'next/image'
import { DollarSign, Film } from 'lucide-react'

export function BidAmountDisplay({ amount }: { amount: number }) {
  return (
    <div className="type-number flex items-center gap-1.5 bid-amount-display">
      <DollarSign className="w-5 h-5" aria-hidden="true" />
      <span>{amount}</span>
    </div>
  )
}

/** Movie identity and bid details without cancellation or counterbid behavior. */
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
        {posterUrl ? (
          <Image src={posterUrl} alt={title} fill sizes="64px" className="object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-6 h-6 text-foreground-muted" aria-hidden="true" />
          </div>
        )}
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
