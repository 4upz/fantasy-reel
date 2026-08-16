'use client'

import { Clock, DollarSign } from 'lucide-react'
import { formatTimeRemaining } from './utils'

interface BidAmountAndDeadlineProps {
  amount: number
  isOutbid: boolean
  responseDeadline: string | null
  processingDeadline: string | null
  /**
   * When another bid on the same movie still has an open counter-response
   * window, processing of the whole group is held until it closes. Set to that
   * window's end so the card explains the delay instead of "Processing soon".
   */
  counterWindowClosesAt?: string | null
}

/**
 * The amount-and-clock line shared by the pickup and counterpick bid cards.
 * Keeping it in one place keeps the two cards from drifting on which deadline a
 * bid is actually waiting on.
 */
export default function BidAmountAndDeadline({
  amount,
  isOutbid,
  responseDeadline,
  processingDeadline,
  counterWindowClosesAt,
}: BidAmountAndDeadlineProps): React.ReactElement {
  // An outbid team is racing its own response window. Everyone else is waiting
  // on processing -- which a rival's still-open counter window holds up.
  const heldUntil = isOutbid ? null : counterWindowClosesAt ?? null
  const deadline = isOutbid ? responseDeadline : processingDeadline

  return (
    <>
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5 bid-amount-display text-lg">
          <DollarSign className="w-5 h-5" />
          <span>{amount}</span>
        </div>

        <div
          className={`flex items-center gap-1.5 text-sm ${
            heldUntil ? 'text-warning' : 'text-foreground-secondary'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>
            {heldUntil
              ? `Counter window · ${formatTimeRemaining(heldUntil)} left`
              : formatTimeRemaining(deadline)}
          </span>
        </div>
      </div>

      {heldUntil && (
        <p className="mt-1.5 text-foreground-muted text-xs">
          Results are on hold until the counter window closes
        </p>
      )}
    </>
  )
}
