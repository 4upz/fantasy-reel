'use client'

import { Clock } from 'lucide-react'
import { BidAmountDisplay } from './BidSummary'
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

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/**
 * The countdown `formatTimeRemaining` abbreviates ("2d 4h"), spelled out for
 * screen readers, which otherwise read it letter by letter. Null once the
 * deadline has passed or is unknown -- there is no countdown to say.
 */
function spokenTimeRemaining(deadline: string | null): string | null {
  if (!deadline) return null
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return null

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) return `${plural(Math.floor(hours / 24), 'day')} ${plural(hours % 24, 'hour')}`
  return `${plural(hours, 'hour')} ${plural(minutes, 'minute')}`
}

/**
 * A countdown shown abbreviated and read out in full. `spokenPrefix` says what
 * the countdown is counting down to; it is only spoken while there is one.
 */
export function TimeRemaining({
  deadline,
  spokenPrefix = '',
}: {
  deadline: string | null
  spokenPrefix?: string
}): React.ReactElement {
  const spoken = spokenTimeRemaining(deadline)
  if (!spoken) return <>{formatTimeRemaining(deadline)}</>
  return (
    <>
      <span aria-hidden="true">{formatTimeRemaining(deadline)}</span>
      <span className="sr-only">{spokenPrefix}{spoken}</span>
    </>
  )
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
        <BidAmountDisplay amount={amount} />

        <div
          className={`type-body-sm flex items-center gap-1.5 ${
            heldUntil ? 'text-warning' : 'text-foreground-secondary'
          }`}
        >
          <Clock className="w-4 h-4" aria-hidden="true" />
          <span className="type-numeric">
            {heldUntil ? (
              <>
                <span aria-hidden="true">Counter window · {formatTimeRemaining(heldUntil)} left</span>
                <span className="sr-only">
                  Counter window closes in {spokenTimeRemaining(heldUntil) ?? 'moments'}
                </span>
              </>
            ) : (
              <TimeRemaining
                deadline={deadline}
                spokenPrefix={isOutbid ? 'Time left to counter: ' : 'Processes in '}
              />
            )}
          </span>
        </div>
      </div>

      {heldUntil && (
        <p className="type-meta mt-1.5 text-foreground-secondary">
          Results are on hold until the counter window closes
        </p>
      )}
    </>
  )
}
