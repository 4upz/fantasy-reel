import DraftBoardHeader from '../../(authenticated)/league/[id]/components/DraftBoardHeader'
import PickOrderQueue, { type PickQueueParticipant } from '../../(authenticated)/league/[id]/components/PickOrderQueue'

const PARTICIPANTS = [
  { user_id: 'example-alice', draft_order: 1, teams: { name: 'Vintage Vibes' }, profiles: { display_name: 'Alice' } },
  { user_id: 'example-bob', draft_order: 2, teams: { name: 'Blockbuster Bob' }, profiles: { display_name: 'Bob' } },
  { user_id: 'example-carol', draft_order: 3, teams: { name: 'Classic Cinema' }, profiles: { display_name: 'Carol' } },
  { user_id: 'example-dave', draft_order: 4, teams: { name: 'Reel Deal' }, profiles: { display_name: 'Dave' } },
] satisfies PickQueueParticipant[]

export default function DraftPreviewScene() {
  return (
    <div className="text-left" style={{ width: 760, height: 352 }}>
      <DraftBoardHeader
        picksMade={12}
        totalPicks={20}
        turn={{ round: 4, pickNumber: 1, teamName: 'Reel Deal', ownerName: 'Dave' }}
        layout="wide"
        queue={(
          <PickOrderQueue
            participants={PARTICIPANTS}
            currentPickIndex={12}
            currentUserId="example-alice"
            rounds={5}
          />
        )}
      />
    </div>
  )
}
