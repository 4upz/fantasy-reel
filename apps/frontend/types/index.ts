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
export interface MovieWithScores extends Movie {
  reviews: Review[]
}

export interface TeamWithScore extends Team {
  team_scores: TeamScore | null
}

export interface ParticipantWithTeamScore extends LeagueParticipant {
  teams: TeamWithScore | null
  profiles: Profile | null
}

export interface DraftPickWithScores extends DraftPick {
  movies: MovieWithScores
}

export interface RankedTeam {
  rank: number
  participant: ParticipantWithTeamScore
  draftPicks: DraftPickWithScores[]
  isTied: boolean
}

// Pickup with review scores for standings display
export interface PickupWithScores extends Pickup {
  movies: MovieWithScores
}

// Counterpick with review scores and team name for standings display
export interface CounterpickWithScores extends Counterpick {
  movies: MovieWithScores
  target_team: { name: string }
}

// Full ranked team with all roster types
export interface RankedTeamFull extends RankedTeam {
  pickups: PickupWithScores[]
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
}

export interface DashboardTeam {
  id: string
  name: string
  avatar_url: string | null
  total_points: number
  rank: number
  movies: MovieTimelineItem[]
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
  source: 'draft_pick' | 'pickup'
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
  created_at: string
  updated_at: string
}

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
  source: 'draft_pick' | 'pickup'
  source_id: string
  title: string
  poster_url: string | null
  release_date: string | null
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
  draft_pick_id: string
  pick_order: number
  phase: 'draft' | 'bidding'
  fantasy_points: number | null
  created_at: string
  updated_at: string
}

export interface CounterpickOption {
  draft_pick_id: string
  movie_id: string
  movie_title: string
  poster_url: string | null
  release_date: string | null
  owner_team_id: string
  owner_team_name: string
  fantasy_points: number | null
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
  draft_pick_id: string
  amount: number
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
// API response types
// ============================================================================

export interface GenerateJoinLinkResponse {
  join_code: string
  join_token: string
  join_url: string
  league_id: string
  league_name: string
}