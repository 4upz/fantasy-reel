import { TeamBudgetSummary } from 'fantasy-reel'
import { team } from './_fixtures'

const budget = {
  id: 'preview-budget',
  team_id: team().id,
  remaining_budget: 72,
  total_spent: 28,
  created_at: '2026-01-04T10:00:00Z',
  updated_at: '2026-01-05T10:00:00Z',
}

export const Default = () => (
  <div className="max-w-sm"><TeamBudgetSummary budget={budget} startingBudget={100} /></div>
)

export const SpentOut = () => (
  <div className="max-w-sm">
    <TeamBudgetSummary budget={{ ...budget, remaining_budget: 0, total_spent: 100 }} startingBudget={100} />
  </div>
)

export const BeforeFirstBid = () => (
  <div className="max-w-sm"><TeamBudgetSummary budget={null} startingBudget={100} /></div>
)
