import { useEffect, useRef } from 'react'
import { ParticipantsList } from 'fantasy-reel'

/**
 * The list is collapsed by default and owns that state internally — there is
 * no prop to open it. `Opened` clicks the component's own disclosure button
 * once on mount so the card shows the roster rather than just a header. This
 * drives the real component; it does not reimplement it.
 */
const AutoExpand = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.click()
  }, [])
  return <div ref={ref}>{children}</div>
}
const participant = (
  n: number,
  teamName: string,
  displayName: string,
  userId: string,
  role: 'owner' | 'admin' | 'member' = 'member'
) => ({
  id: `p${n}`,
  league_id: '11111111-1111-4111-8111-111111111111',
  user_id: userId,
  role,
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

const OWNER = '22222222-2222-4222-8222-222222222222'

const roster = [
  participant(1, 'The Spielbergs', 'Alice Spielberg', OWNER, 'owner'),
  participant(2, 'Nolan’s Eleven', 'Bob Nolan', '33333333-3333-4333-8333-333333333333'),
  participant(3, 'The Godfathers', 'Carol Coppola', '44444444-4444-4444-8444-444444444444'),
  participant(4, 'Kubrick’s Odyssey', 'Dave Kubrick', '55555555-5555-4555-8555-555555555555'),
]

/** Expanded: team name, owner display name, draft order, and the owner tag. */
export const Opened = () => (
  <AutoExpand>
    <div className="max-w-lg">
      <ParticipantsList participants={roster as never} ownerId={OWNER} />
    </div>
  </AutoExpand>
)

/** How it actually arrives on the page — collapsed, with the count as the
    at-a-glance value. */
export const Collapsed = () => (
  <div className="max-w-lg">
    <ParticipantsList participants={roster as never} ownerId={OWNER} />
  </div>
)

/** A league still filling up. */
export const PartiallyFilled = () => (
  <AutoExpand>
    <div className="max-w-lg">
      <ParticipantsList participants={roster.slice(0, 2) as never} ownerId={OWNER} />
    </div>
  </AutoExpand>
)

/** Nobody has joined yet. */
export const Empty = () => (
  <AutoExpand>
    <div className="max-w-lg">
      <ParticipantsList participants={[]} ownerId={OWNER} />
    </div>
  </AutoExpand>
)
