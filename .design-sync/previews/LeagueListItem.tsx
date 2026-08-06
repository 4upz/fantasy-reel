import { LeagueListItem } from 'fantasy-reel'

const league = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Summer Blockbusters',
    owner_id: '22222222-2222-4222-8222-222222222222',
    invite_only: false,
    status: 'active',
    max_participants: 8,
    draft_start_date: null,
    draft_end_date: null,
    total_slots: 8,
    draft_slots: 5,
    drop_limit: 2,
    counterbid_hours: 24,
    draft_counterpick_slots: 1,
    bidding_counterpick_slots: 1,
    counterpicks_block_drops: false,
    custom_draft_order: false,
    join_code: null,
    join_token: null,
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
    ...over,
  }) as never

export const Default = () => (
  <div className="max-w-xl">
    <LeagueListItem league={league()} />
  </div>
)

/** The status badge is the row's main variant axis — one per league phase. */
export const Statuses = () => (
  <div className="flex flex-col gap-3 max-w-xl">
    <LeagueListItem league={league({ name: 'Awards Season 2026', status: 'setup' })} />
    <LeagueListItem league={league({ name: 'Summer Blockbusters', status: 'drafting' })} />
    <LeagueListItem league={league({ name: 'Indie Darlings', status: 'active' })} />
    <LeagueListItem league={league({ name: 'Winter Prestige', status: 'completed' })} />
  </div>
)

/** Private leagues read "Private" in the meta line instead of "Open". */
export const PrivateLeague = () => (
  <div className="max-w-xl">
    <LeagueListItem
      league={league({ name: 'The Critics’ Circle', invite_only: true, max_participants: 6 })}
    />
  </div>
)

/** Long names truncate rather than pushing the badge out of the row. */
export const LongName = () => (
  <div className="max-w-xl">
    <LeagueListItem
      league={league({ name: 'The Extremely Serious Cinephiles Prestige Invitational League' })}
    />
  </div>
)
