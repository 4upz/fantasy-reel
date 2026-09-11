import { SeriesListItem } from 'fantasy-reel'

const season = (over: Partial<Record<string, unknown>> = {}) =>
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
    series_id: '33333333-3333-4333-8333-333333333333',
    season_year: 2026,
    season_end: '2026-12-31',
    completed_at: null,
    winner_team_ids: null,
    final_standings: null,
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
    ...over,
  }) as never

/** One row of a frozen final table, enough to name a champion. */
const finalRow = (team_id: string, team_name: string, display_name: string) => ({
  team_id,
  team_name,
  participant_id: `p-${team_id}`,
  user_id: `u-${team_id}`,
  display_name,
  total_points: 345,
  rank: 1,
  is_tied: false,
})

/** The common case: one season, so the card is exactly the row it replaced. */
export const Default = () => (
  <div className="max-w-xl">
    <SeriesListItem seasons={[season()]} />
  </div>
)

/** The status badge is the card's main variant axis — one per league phase. */
export const Statuses = () => (
  <div className="flex flex-col gap-3 max-w-xl">
    <SeriesListItem seasons={[season({ name: 'Awards Season', status: 'setup' })]} />
    <SeriesListItem seasons={[season({ name: 'Summer Blockbusters', status: 'drafting' })]} />
    <SeriesListItem seasons={[season({ name: 'Indie Darlings', status: 'active' })]} />
    <SeriesListItem seasons={[season({ name: 'Winter Prestige', status: 'completed' })]} />
  </div>
)

/**
 * A league with history. The extra row is a real button outside the card's
 * link, so the two are separately reachable by keyboard.
 */
export const WithPastSeasons = () => (
  <div className="max-w-xl">
    <SeriesListItem
      seasons={[
        season({ name: 'Oscar Contenders', season_year: 2026 }),
        season({
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Oscar Contenders',
          season_year: 2025,
          status: 'completed',
          winner_team_ids: ['team-2025'],
          final_standings: [finalRow('team-2025', 'Academy Aces', 'Alice Spielberg')],
        }),
        season({
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Oscar Contenders',
          season_year: 2024,
          status: 'completed',
          winner_team_ids: ['team-2024'],
          final_standings: [finalRow('team-2024', 'Golden Globe Gang', 'Bob Nolan')],
        }),
      ]}
    />
  </div>
)

/** Long names truncate rather than pushing the badge and year out of the row. */
export const LongName = () => (
  <div className="max-w-xl">
    <SeriesListItem
      seasons={[season({ name: 'The Extremely Serious Cinephiles Prestige Invitational League' })]}
    />
  </div>
)
