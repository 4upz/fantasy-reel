import type { TeamBudget } from '@/types'

/** A team with no budget row yet has not bid, so it still holds the full purse. */
export function remainingFaab(budget: TeamBudget | null | undefined, startingFaab: number): number {
  return budget?.remaining_budget ?? startingFaab
}

export function formatFaab(amount: number): string {
  return `$${amount}`
}

/** Money reads gold everywhere in the app; a spent-out team goes quiet instead. */
export function faabTone(remaining: number): string {
  return remaining > 0 ? 'text-gold' : 'text-foreground-muted'
}

/**
 * Spending power is only worth reading against what a team started with, so the
 * detail views pair what is left with what is gone. A depleted team reads muted -
 * "can't outbid me" is the fact you came for, and it should be visible at a glance.
 */
export default function TeamFaab({
  budget,
  startingFaab,
}: {
  budget: TeamBudget | null | undefined
  startingFaab: number
}) {
  const remaining = remainingFaab(budget, startingFaab)
  const spent = budget?.total_spent ?? 0

  return (
    <div className="flex items-center justify-between gap-2 rounded-[11px] border border-border bg-background px-[11px] py-2">
      <span className="text-[11px] uppercase tracking-[0.1em] text-foreground-muted">FAAB</span>
      <span className="text-[13px] text-foreground-muted">
        <span className={`font-semibold ${faabTone(remaining)}`}>{formatFaab(remaining)}</span>{' '}
        left · {formatFaab(spent)} spent
      </span>
    </div>
  )
}
