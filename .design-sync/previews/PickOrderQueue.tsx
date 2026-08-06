import { PickOrderQueue } from 'fantasy-reel'

const participant = (n: number, teamName: string, displayName: string, userId: string) => ({
  id: `p${n}`,
  league_id: '11111111-1111-4111-8111-111111111111',
  user_id: userId,
  role: 'member' as const,
  status: 'active' as const,
  draft_order: n,
  joined_at: '2026-05-02T10:00:00Z',
  created_at: '2026-05-02T10:00:00Z',
  updated_at: '2026-05-02T10:00:00Z',
  teams: {
    id: `t${n}`,
    participant_id: `p${n}`,
    name: teamName,
    avatar_url: null,
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
  },
  profiles: {
    id: `pr${n}`,
    user_id: userId,
    display_name: displayName,
    avatar_url: null,
    wishlist_public: false,
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
  },
})

const ME = '33333333-3333-4333-8333-333333333333'

const roster = [
  participant(1, 'The Spielbergs', 'Alice Spielberg', '22222222-2222-4222-8222-222222222222'),
  participant(2, 'Nolan’s Eleven', 'Bob Nolan', ME),
  participant(3, 'The Godfathers', 'Carol Coppola', '44444444-4444-4444-8444-444444444444'),
  participant(4, 'Kubrick’s Odyssey', 'Dave Kubrick', '55555555-5555-4555-8555-555555555555'),
]

/** Mid-draft. The pick on the clock is highlighted; the viewer's own upcoming
    picks are marked so they can see how long the wait is. */
export const MidDraft = () => (
  <div className="max-w-2xl">
    <PickOrderQueue participants={roster as never} currentPickIndex={2} currentUserId={ME} rounds={5} />
  </div>
)

/** It is the viewer's turn — the "your pick" treatment. */
export const YourTurn = () => (
  <div className="max-w-2xl">
    <PickOrderQueue participants={roster as never} currentPickIndex={1} currentUserId={ME} rounds={5} />
  </div>
)

/** The very start of a draft. */
export const DraftStart = () => (
  <div className="max-w-2xl">
    <PickOrderQueue participants={roster as never} currentPickIndex={0} currentUserId={ME} rounds={3} />
  </div>
)
