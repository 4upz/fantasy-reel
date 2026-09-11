import { DraftBoardHeader } from 'fantasy-reel'

const turn = { round: 2, pickNumber: 3, teamName: 'The Spielbergs', ownerName: 'Alice Spielberg' }

export const Default = () => (
  <div className="max-w-2xl">
    <DraftBoardHeader picksMade={10} totalPicks={40} turn={turn} />
  </div>
)

export const YourTurn = () => (
  <div className="max-w-2xl">
    <DraftBoardHeader picksMade={10} totalPicks={40} turn={turn} isMyTurn />
  </div>
)

export const Complete = () => (
  <div className="max-w-2xl">
    <DraftBoardHeader picksMade={40} totalPicks={40} turn={null} isDraftComplete />
  </div>
)
