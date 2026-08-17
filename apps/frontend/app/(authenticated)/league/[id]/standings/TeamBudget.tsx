import type { TeamBudget } from '@/types'

/** A team with no budget row yet has not bid, so it still holds the full purse. */
export function remainingBudget(budget: TeamBudget | null | undefined, startingBudget: number): number {
  return budget?.remaining_budget ?? startingBudget
}

export function formatBudget(amount: number): string {
  return `$${amount}`
}

/** Money reads gold everywhere in the app; a spent-out team goes quiet instead. */
export function budgetTone(remaining: number): string {
  return remaining > 0 ? 'text-gold' : 'text-foreground-muted'
}

/**
 * Spending power is only worth reading against what a team started with, so the
 * detail views pair what is left with what is gone. A depleted team reads muted -
 * "can't outbid me" is the fact you came for, and it should be visible at a glance.
 */
export default function TeamBudgetSummary({
  budget,
  startingBudget,
}: {
  budget: TeamBudget | null | undefined
  startingBudget: number
}) {
  const remaining = remainingBudget(budget, startingBudget)
  const spent = budget?.total_spent ?? 0

  return (
    <div className="flex items-center justify-between gap-2 rounded-[11px] border border-border bg-background px-[11px] py-2">
      <span className="text-[11px] uppercase tracking-[0.1em] text-foreground-muted">Budget</span>
      <span className="text-[13px] text-foreground-muted">
        <span className={`font-semibold ${budgetTone(remaining)}`}>{formatBudget(remaining)}</span>{' '}
        left · {formatBudget(spent)} spent
      </span>
    </div>
  )
}
