import { ConfirmKickModal } from 'fantasy-reel'
import { Stage } from './_stage'

const participant = {
  id: 'p2',
  league_id: '11111111-1111-4111-8111-111111111111',
  user_id: '33333333-3333-4333-8333-333333333333',
  role: 'member' as const,
  status: 'active' as const,
  draft_order: 2,
  joined_at: '2026-05-02T10:00:00Z',
  created_at: '2026-05-02T10:00:00Z',
  updated_at: '2026-05-02T10:00:00Z',
  teams: {
    id: 't2',
    participant_id: 'p2',
    name: 'Nolan’s Eleven',
    avatar_url: null,
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
  },
  profiles: {
    id: 'pr2',
    user_id: '33333333-3333-4333-8333-333333333333',
    display_name: 'Bob Nolan',
    avatar_url: null,
    wishlist_public: false,
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
  },
}

const noop = () => {}
const noopAsync = async () => {}

/** Destructive confirmation for removing a participant from a league. */
export const Default = () => (
  <Stage width={820} height={420}>
    <ConfirmKickModal
      participant={participant as never}
      onConfirm={noopAsync}
      onCancel={noop}
      loading={false}
    />
  </Stage>
)

export const Loading = () => (
  <Stage width={820} height={420}>
    <ConfirmKickModal
      participant={participant as never}
      onConfirm={noopAsync}
      onCancel={noop}
      loading
    />
  </Stage>
)
