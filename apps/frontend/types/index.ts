// TypeScript interfaces for Fantasy Reel data types

export interface League {
  id: string
  name: string
  owner_id: string
  invite_only: boolean
  status: 'setup' | 'drafting' | 'counterpicking' | 'active' | 'completed'
  max_participants: number
  draft_start_date: string | null
  draft_end_date: string | null
  // Bidding configuration
  total_slots: number
  draft_slots: number
  drop_limit: number
  counterbid_hours: number
  /**
   * Hours before the weekly processing deadline after which no new bids may be
   * opened -- only raises and counters on movies already being bid on. 48 puts
   * the cutoff at Thursday 8pm UTC; 0 disables it.
   */
  new_bid_cutoff_hours: number
  // Counterpick configuration
  draft_counterpick_slots: number
  bidding_counterpick_slots: number
  counterpicks_block_drops: boolean
  // Draft order customization
  custom_draft_order: boolean
  // Shareable join link
  join_code: string | null
  join_token: string | null
  created_at: string
  updated_at: string
}

export interface LeagueParticipant {
  id: string
  league_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'active' | 'left' | 'kicked'
  draft_order: number
  joined_at: string
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  participant_id: string
  name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Movie {
  id: string
  tmdb_id: number
  imdb_id: string | null
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  backdrop_url: string | null
  popularity: number | null
  vote_average: number | null
  vote_count: number | null
  status: 'upcoming' | 'released' | 'canceled'
  combined_score: number | null
  fantasy_points: number | null
  scores_updated_at: string | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

export interface DraftPick {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  round: number
  pick_number: number
  picked_at: string
  created_at: string
  dropped_at: string | null
  counterpicked_by_team_id: string | null
}

// ============================================================================
// Roster holdings (the `team_holdings` view)
// ============================================================================

/** How a team came by a movie. Mirrors `team_holdings.source`. */
export type HoldingSource = 'draft' | 'pickup'

/**
 * The same distinction in base-table vocabulary, which is what the trade tables
 * and the dashboard's release board speak. `holdingSourceName()` converts.
 */
export type HoldingSourceName = 'draft_pick' | 'pickup'

/**
 * What a trade item refers to: a roster holding, or a counterpick.
 *
 * A counterpick is an asset in its own right -- the inverted bet a team owns
 * against somebody else's movie -- and is tradeable like any holding, so trade
 * items speak a slightly wider vocabulary than rosters do. `source_id` points
 * at `counterpicks.id` for that case.
 */
export type TradeItemSource = HoldingSourceName | 'counterpick'

/**
 * One movie a team holds right now, read from the `team_holdings` view.
 *
 * The view unions `draft_picks` and `pickups` with dropped rows already
 * excluded, so a reader can no longer forget a leg. PostgREST cannot embed
 * through a UNION view, which is why the team and movie columns arrive flat
 * (`title`, `team_name`, `counterpicked_by_name`) instead of nested, and why
 * the movie's own status is `movie_status`.
 */
export interface TeamHolding {
  /** The `draft_picks` / `pickups` row id -- what drop-movie and trades take. */
  holding_id: string
  source: HoldingSource
  league_id: string
  team_id: string
  movie_id: string
  acquired_at: string
  counterpicked_by_team_id: string | null
  counterpicked_by_name: string | null
  /** Draft holdings only; null on a pickup. */
  round: number | null
  pick_number: number | null
  /** Pickup holdings only; null on a draft pick. */
  bid_id: string | null
  amount_paid: number | null
  team_name: string
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
  movie_status: Movie['status']
  imdb_id: string | null
  combined_score: number | null
  fantasy_points: number | null
  overview: string | null
  backdrop_url: string | null
  vote_average: number | null
  vote_count: number | null
  popularity: number | null
  scoring_bonuses: Record<string, unknown> | null
  scores_updated_at: string | null
}

/**
 * The movie a holding is for, lifted back out of the flat view row.
 *
 * Narrower than `Movie` on purpose: these are the fields the roster and
 * standings surfaces actually read, and the shape is a superset of
 * `LeagueMovieRef` so a row opens the shared movie dialog without converting.
 */
export interface HoldingMovie {
  id: string
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  status: Movie['status']
  vote_average: number | null
  popularity: number | null
  combined_score: number | null
  fantasy_points: number | null
}

export interface Review {
  id: string
  movie_id: string
  source: 'imdb' | 'rotten_tomatoes' | 'metacritic'
  score: number | null
  raw_score: string | null
  review_count: number | null
  fetched_at: string
  created_at: string
  updated_at: string
}

export interface TeamScore {
  id: string
  team_id: string
  total_points: number
  draft_points: number
  pickup_points: number
  counterpick_points: number
  counterpicks_made: number
  counterpicks_scored: number
  movies_scored: number
  movies_pending: number
  average_score: number
  last_calculated_at: string
  created_at: string
  updated_at: string
}

export interface Invitation {
  id: string
  league_id: string
  invited_by: string
  email: string
  token: string
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'
  sent_at: string
  expires_at: string
  responded_at: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  user_id: string
  display_name: string | null
  avatar_url: string | null
  wishlist_public: boolean
  created_at: string
  updated_at: string
}

// Joined types for queries with relations
export interface ParticipantWithTeam extends LeagueParticipant {
  teams: Team | null
}

export interface DraftPickWithDetails extends DraftPick {
  movies: Movie
  teams: Team
}

export interface InvitationWithLeague extends Invitation {
  leagues: {
    id: string
    name: string
    status: 'setup' | 'drafting' | 'counterpicking' | 'active' | 'completed'
    owner_id: string
  } | null
}

// Standings page types
export interface TeamWithScore extends Team {
  team_scores: TeamScore | null
  /** Every league member can read every budget, so standings show all of them. */
  team_budgets: TeamBudget | null
}

export interface ParticipantWithTeamScore extends LeagueParticipant {
  teams: TeamWithScore | null
  profiles: Profile | null
}

/** A drafted holding as the standings show it: the pick, plus its movie. */
export interface DraftHolding {
  id: string
  team_id: string
  movie_id: string
  round: number
  pick_number: number
  counterpicked_by_team_id: string | null
  movie: HoldingMovie
}

/** An auction win as the standings show it: the pickup, plus its movie. */
export interface PickupHolding {
  id: string
  team_id: string
  movie_id: string
  amount_paid: number
  counterpicked_by_team_id: string | null
  movie: HoldingMovie
}

export interface RankedTeam {
  rank: number
  participant: ParticipantWithTeamScore
  draftPicks: DraftHolding[]
  isTied: boolean
}

// Counterpick with its movie and target team name for standings display
export interface CounterpickWithScores extends Counterpick {
  movies: HoldingMovie
  target_team: { name: string }
}

// Full ranked team with all roster types
export interface RankedTeamFull extends RankedTeam {
  pickups: PickupHolding[]
  counterpicks: CounterpickWithScores[]
}

// Settings page types
export interface ParticipantWithProfile extends LeagueParticipant {
  teams: Team | null
  profiles: Profile | null
}

export interface NextPickInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
}

// TMDb API types (from Edge Functions)
export interface TMDbSearchResult {
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

export interface WishlistedMovie {
  id: string
  user_id: string
  tmdb_id: number
  title: string
  poster_url: string | null
  added_at: string
}

export interface TMDbSearchResponse {
  page: number
  total_pages: number
  total_results: number
  results: TMDbSearchResult[]
}

export interface TMDbCastMember {
  id: number
  name: string
  character: string
  profile_url: string | null
}

export interface TMDbMovieDetails {
  tmdb_id: number
  imdb_id: string | null
  title: string
  tagline: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: string
  poster_url: string | null
  backdrop_url: string | null
  vote_average: number
  vote_count: number
  genres: Array<{ id: number; name: string }>
  cast: TMDbCastMember[]
  director: string | null
}

// TMDb genre IDs for filtering
export const TMDB_GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Science Fiction' },
  { id: 10770, name: 'TV Movie' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
] as const

// ============================================================================
// Bidding system types
// ============================================================================

export type BidStatus = 'active' | 'outbid' | 'won' | 'lost' | 'cancelled'

export interface PickupBid {
  id: string
  league_id: string
  team_id: string
  tmdb_id: number
  movie_data: TMDbSearchResult | null
  amount: number
  status: BidStatus
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

export interface TeamBudget {
  id: string
  team_id: string
  remaining_budget: number
  total_spent: number
  created_at: string
  updated_at: string
}

export interface Pickup {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  bid_id: string
  amount_paid: number
  picked_up_at: string
  dropped_at: string | null
  counterpicked_by_team_id: string | null
  created_at: string
}

export interface TeamDrop {
  id: string
  team_id: string
  movie_id: string
  pickup_id: string | null
  draft_pick_id: string | null
  dropped_at: string
  created_at: string
}

export type NotificationType =
  | 'outbid'
  | 'bid_won'
  | 'bid_lost'
  | 'pickup_available'
  | 'trade_proposed'
  | 'trade_countered'
  | 'trade_accepted'
  | 'trade_rejected'
  | 'trade_cancelled'
  | 'trade_completed'
  | 'trade_vetoed'

export interface Notification {
  id: string
  user_id: string
  league_id: string | null
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

// Extended bidding types for queries with relations
export interface PickupWithMovie extends Pickup {
  movies: Movie
}

export interface PickupBidWithTeam extends PickupBid {
  teams: Team
}

export interface TeamWithBudget extends Team {
  team_budgets: TeamBudget | null
}

export interface ParticipantWithTeamBudget extends LeagueParticipant {
  teams: TeamWithBudget | null
  profiles: Profile | null
}

// ============================================================================
// Dashboard types
// ============================================================================

export interface MovieTimelineItem {
  id: string
  tmdb_id: number
  title: string
  poster_url: string | null
  release_date: string | null
  status: 'scored' | 'releasing_soon' | 'upcoming'
  /** The Tomatometer - the only critic score that affects fantasy points. */
  combined_score: number | null
  fantasy_points: number | null
  /** Decides how the overview labels the movie: a draft slot or a winning bid. */
  source: HoldingSource
  /** Where the movie was drafted. Null on a pickup. */
  round: number | null
  pick_number: number | null
  /** What the pickup cost. Null on a draft pick. */
  amount_paid: number | null
}

export interface DashboardTeam {
  id: string
  name: string
  avatar_url: string | null
  total_points: number
  rank: number
  movies: MovieTimelineItem[]
}

/**
 * One unreleased movie held by any team in the league, for the dashboard's
 * league-wide release board. Flat by design: the board prints who holds it, not
 * the whole team row, and the shape is a superset of `LeagueMovieRef` so a row
 * opens the shared movie dialog without converting first.
 */
export interface LeagueUpcomingRelease {
  id: string
  tmdb_id: number
  title: string
  poster_url: string | null
  /** Never null in practice - the query only returns dated, future releases. */
  release_date: string
  /** How the holding was acquired. Drafted movies win a tie against a pickup. */
  source: HoldingSourceName
  team_id: string
  team_name: string
  /** profiles.display_name is nullable, so the board falls back to the team. */
  owner_name: string | null
  /** Lets a row mark itself yours without the client re-deriving your team. */
  is_current_user_team: boolean
}

export interface StandingEntry {
  rank: number
  isTied: boolean
  team: {
    id: string
    name: string
    avatar_url: string | null
  }
  total_points: number
  topMovie: {
    title: string
    score: number
  } | null
  isCurrentUser: boolean
}

// ============================================================================
// Trading system types
// ============================================================================

export type TradeStatus =
  | 'proposed'
  | 'countered'
  | 'accepted'
  | 'review'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'vetoed'
  | 'expired'

export interface TradeMovieItem {
  movie_id: string
  source: TradeItemSource
  source_id: string
  // Cached movie data for display
  title?: string
  poster_url?: string | null
  release_date?: string | null
}

export interface TradeItems {
  movies: TradeMovieItem[]
  faab: number
}

export interface TradeOffer {
  id: string
  league_id: string
  initiator_team_id: string
  recipient_team_id: string
  initiator_items: TradeItems
  recipient_items: TradeItems
  status: TradeStatus
  proposed_at: string
  responded_at: string | null
  accepted_at: string | null
  review_ends_at: string | null
  completed_at: string | null
  initiator_message: string | null
  response_message: string | null
  veto_reason: string | null
  /**
   * Commissioner who approved the trade before its review window expired;
   * NULL when it completed on the review clock instead. Audit only -- the UI
   * deliberately doesn't distinguish the two, since a completed trade had the
   * commissioner's blessing either way.
   */
  approved_by?: string | null
  created_at: string
  updated_at: string
  /**
   * source_ids in this offer that at least one other open offer also names.
   * Populated by get-trades; absent on offers loaded from anywhere else.
   *
   * Several offers may compete for the same movie (see migration
   * 20260809120000) and only the first to execute wins, so a contested movie
   * means this deal may lose. Counts are deliberately not exposed -- who else is
   * bidding is private to those trades' own participants.
   */
  contested_source_ids?: string[]
  /**
   * When this unanswered offer lapses. NULL means it stands forever -- the
   * pre-expiry behavior, still a first-class choice, and what every offer
   * created before the feature keeps.
   *
   * Not to be confused with `review_ends_at` (the post-accept commissioner
   * window) or the league's season-level `trade_deadline`.
   */
  expires_at?: string | null
  /**
   * How `expires_at` was derived. 'fixed' never moves; 'first_release' tracks
   * the earliest release among the offer's movies and is re-resolved by the
   * process-trades cron whenever that date shifts.
   */
  expiry_anchor?: ExpiryAnchor | null
  /**
   * Why an expired offer expired. NULL on offers that expired for a reason
   * `veto_reason` explains instead (a competing trade executed, or the offer
   * stopped validating).
   */
  expired_reason?: ExpiredReason | null
}

export type ExpiryAnchor = 'fixed' | 'first_release'
export type ExpiredReason = 'offer_window' | 'movie_released' | 'league_deadline'

export interface TradeAsset {
  id: string
  trade_offer_id: string
  from_team_id: string
  to_team_id: string
  movie_id: string | null
  draft_pick_id: string | null
  pickup_id: string | null
  faab_amount: number | null
  transferred_at: string
  created_at: string
}

// Extended types for queries with relations
export interface TradeOfferWithTeams extends TradeOffer {
  initiator_team: Team
  recipient_team: Team
}

export interface TradeOfferWithDetails extends TradeOfferWithTeams {
  trade_assets?: TradeAsset[]
}

// For the trade proposal UI - team's available movies
export interface TradeableMovie {
  movie_id: string
  source: TradeItemSource
  source_id: string
  title: string
  poster_url: string | null
  release_date: string | null
  /**
   * For a counterpick, the team currently holding the movie it targets -- the
   * only way to tell "Dune" from "the bet against whoever holds Dune" in a
   * list. Null for roster holdings.
   */
  counterpick_target_team_name?: string | null
  /** Tomatometer score (0-100), for context only - not a points value. */
  combined_score: number | null
  /** Fantasy points the movie is actually worth; null until it has an RT score. */
  fantasy_points: number | null
}

// ============================================================================
// Team display types (used in trading, draft, etc.)
// ============================================================================

/**
 * Team info with owner's display name for UI components
 * Used when showing team name + owner name together
 */
export interface TeamWithOwner {
  id: string
  name: string
  avatar_url: string | null
  display_name: string | null
}

// ============================================================================
// Counterpick system types
// ============================================================================

export interface Counterpick {
  id: string
  league_id: string
  counterpicker_team_id: string
  target_team_id: string
  movie_id: string
  draft_pick_id: string | null
  pickup_id: string | null
  pick_order: number
  phase: 'draft' | 'bidding'
  fantasy_points: number | null
  created_at: string
  updated_at: string
}

export interface CounterpickOption {
  draft_pick_id: string | null
  movie_id: string
  movie_title: string
  poster_url: string | null
  release_date: string | null
  owner_team_id: string
  owner_team_name: string
  fantasy_points: number | null
  source: 'draft' | 'pickup'
  pickup_id: string | null
}

export interface CounterpickTurnInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
  counterpicks_remaining: number
}

// Extended counterpick types for queries with relations
export interface CounterpickWithDetails extends Counterpick {
  movies: Movie
  target_team: Team
  counterpicker_team: Team
}

export interface CounterpickBid {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  target_team_id: string
  draft_pick_id: string | null
  pickup_id: string | null
  amount: number
  /**
   * The team's own ranking of its pending counterpick bids, 1 first. Decides
   * which counterpicks it keeps when more bids win than it has slots for.
   */
  priority: number
  status: BidStatus
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
  // Joined fields (from query)
  movies?: { title: string; poster_url: string | null; release_date: string | null; fantasy_points: number | null }
  target_team?: { name: string }
}

// ============================================================================
// Bid history types
// ============================================================================

/** One team's settled bid within a contest. */
export interface BidHistoryEntry {
  bidId: string
  teamId: string
  amount: number
}

/**
 * Every settled bid on one movie from a single contest. Cancelled bids are left
 * out entirely - a team that walked away before processing never competed.
 */
export interface BidHistoryResult {
  kind: 'pickup' | 'counterpick'
  /** Unique per contest, so a movie won twice in a season yields two results. */
  id: string
  title: string
  posterUrl: string | null
  releaseDate: string | null
  /** The bid that took the movie, or null when no bid survived processing. */
  winner: BidHistoryEntry | null
  /** Beaten bids, highest first. */
  losers: BidHistoryEntry[]
  /** Counterpicks only: the team whose movie was targeted. */
  targetTeamId?: string
}

/** One processing run's results. */
export interface BidHistoryRound {
  /** UTC calendar date (YYYY-MM-DD) the round's bids were processed on. */
  date: string
  results: BidHistoryResult[]
}

// ============================================================================
// API response types
// ============================================================================

export interface GenerateJoinLinkResponse {
  join_code: string
  join_token: string
  join_url: string
  league_id: string
  league_name: string
}