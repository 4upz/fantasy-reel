import { RosterHeader } from 'fantasy-reel'

const roster = { teamName: 'The Spielbergs', slotsFilled: 4, totalSlots: 5, remainingBudget: 72, dropCount: 1, dropLimit: 3 }

export const Default = () => (
  <div className="max-w-2xl"><RosterHeader {...roster} /></div>
)

export const NoDropsLeft = () => (
  <div className="max-w-2xl"><RosterHeader {...roster} dropCount={3} /></div>
)
