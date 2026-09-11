import { TeamStandingSummary } from 'fantasy-reel'

const team = {
  rank: 1,
  isTied: false,
  displayName: 'The Spielbergs',
  ownerHandle: 'Alice Spielberg',
  isCurrentUser: true,
  movieCount: 5,
  moviesScored: 3,
  moviesPending: 2,
  budgetLeft: 72,
  totalPoints: 104,
}

export const Default = () => (
  <div className="card flex flex-col gap-3 p-4 max-w-2xl">
    <TeamStandingSummary {...team} />
  </div>
)

export const TiedWithoutBudget = () => (
  <div className="card flex flex-col gap-3 p-4 max-w-2xl">
    <TeamStandingSummary {...team} rank={4} isTied isCurrentUser={false} budgetLeft={null} totalPoints={-12} />
  </div>
)
