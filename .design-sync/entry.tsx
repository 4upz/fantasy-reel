// Design-system barrel for design-sync. GENERATED — DO NOT EDIT.
//
// Regenerate with `npm run design:barrel`. Membership is declared by a
// `/** @design-system <Section> */` tag on the component itself, so this file
// is derived state; editing it by hand is undone by the next run.
//
// Fantasy Reel is a Next.js app, not a published component package, so there
// is no `dist/` entry to bundle. This file is that entry: it re-exports the
// app's real, shipped components under stable names. Nothing here
// reimplements a component — every export points at what the app renders.

// ── Context ─────────────────────────────────────────────────────────────
export { WishlistProvider } from "../apps/frontend/hooks/useWishlist"

// ── Foundation ──────────────────────────────────────────────────────────
export { default as Avatar } from "../apps/frontend/app/components/Avatar"
export { default as CounterpickMark } from "../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickMark"
export { default as DateTimeField } from "../apps/frontend/app/components/DateTimeField"
export { default as DraftProgressRing } from "../apps/frontend/app/(authenticated)/league/[id]/components/DraftProgressRing"
export { LoadingSpinner } from "../apps/frontend/app/components/LoadingSpinner"
export { default as TomatometerScore } from "../apps/frontend/app/components/TomatometerScore"

// ── Feedback ────────────────────────────────────────────────────────────
export { default as ConnectionStatusIndicator } from "../apps/frontend/app/(authenticated)/league/[id]/components/ConnectionStatusIndicator"
export { ErrorAlert, FormError, FormSuccess } from "../apps/frontend/app/components/FormError"
export { default as MovieCardSkeleton } from "../apps/frontend/app/(authenticated)/movies/components/MovieCardSkeleton"
export { default as MovieGridSkeleton } from "../apps/frontend/app/(authenticated)/movies/components/MovieGridSkeleton"

// ── Movies ──────────────────────────────────────────────────────────────
export { default as DraftFilters } from "../apps/frontend/app/(authenticated)/league/[id]/components/DraftFilters"
export { default as DraftMovieCard } from "../apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard"
export { default as FranchiseHistoryPanel } from "../apps/frontend/app/components/FranchiseHistoryPanel"
export { default as FranchiseSummary } from "../apps/frontend/app/components/FranchiseSummary"
export { default as MovieCard } from "../apps/frontend/app/(authenticated)/movies/components/MovieCard"
export { default as MovieDetailModal } from "../apps/frontend/app/(authenticated)/movies/components/MovieDetailModal"
export { default as MovieFilters } from "../apps/frontend/app/(authenticated)/movies/components/MovieFilters"
export { default as MovieGrid } from "../apps/frontend/app/(authenticated)/movies/components/MovieGrid"
export { default as MovieSearchBar } from "../apps/frontend/app/(authenticated)/movies/components/MovieSearchBar"
export { default as MovieTimelineCard } from "../apps/frontend/app/(authenticated)/league/[id]/components/MovieTimelineCard"

// ── League ──────────────────────────────────────────────────────────────
export {
  default as BidSummary,
  BidAmountDisplay,
} from "../apps/frontend/app/(authenticated)/league/[id]/components/BidSummary"
export { default as BidCard } from "../apps/frontend/app/(authenticated)/league/[id]/components/BidCard"
export { default as BidPriorityList } from "../apps/frontend/app/(authenticated)/league/[id]/components/BidPriorityList"
export { default as BidWeekTimeline } from "../apps/frontend/app/(authenticated)/league/[id]/components/BidWeekTimeline"
export { default as ChampionBanner } from "../apps/frontend/app/(authenticated)/league/[id]/components/ChampionBanner"
export { default as ChampionCrown } from "../apps/frontend/app/(authenticated)/league/[id]/components/ChampionCrown"
export {
  default as OfferExpiryPicker,
  Chip,
} from "../apps/frontend/app/(authenticated)/league/[id]/components/OfferExpiryPicker"
export { default as CounterpickBidCard } from "../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickBidCard"
export { default as CounterpickPriorityList } from "../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickPriorityList"
export { default as DraftBoardHeader } from "../apps/frontend/app/(authenticated)/league/[id]/components/DraftBoardHeader"
export { default as MovieScoreCard } from "../apps/frontend/app/(authenticated)/league/[id]/standings/MovieScoreCard"
export { default as MovieTimeline } from "../apps/frontend/app/(authenticated)/league/[id]/components/MovieTimeline"
export { default as ParticipantsList } from "../apps/frontend/app/(authenticated)/league/[id]/components/ParticipantsList"
export { default as PickOrderQueue } from "../apps/frontend/app/(authenticated)/league/[id]/components/PickOrderQueue"
export { default as PriorityList } from "../apps/frontend/app/(authenticated)/league/[id]/components/PriorityList"
export {
  RosterHeader,
  RosterMovieCard,
  RosterPoster,
} from "../apps/frontend/app/(authenticated)/league/[id]/roster/RosterPresentation"
export { default as SeasonHistoryList } from "../apps/frontend/app/(authenticated)/league/[id]/components/SeasonHistoryList"
export { default as SeasonWelcomeCard } from "../apps/frontend/app/(authenticated)/league/[id]/components/SeasonWelcomeCard"
export { default as SeriesListItem } from "../apps/frontend/app/components/SeriesListItem"
export { default as StandingsSidebar } from "../apps/frontend/app/(authenticated)/league/[id]/components/StandingsSidebar"
export { default as TeamBudgetSummary } from "../apps/frontend/app/(authenticated)/league/[id]/standings/TeamBudget"
export { default as TeamHeader } from "../apps/frontend/app/(authenticated)/league/[id]/components/TeamHeader"
export { default as TeamStandingSummary } from "../apps/frontend/app/(authenticated)/league/[id]/standings/TeamStandingSummary"
export { default as TradeItemsSection } from "../apps/frontend/app/(authenticated)/league/[id]/components/TradeItemsSection"
export { default as TradeOfferCard } from "../apps/frontend/app/(authenticated)/league/[id]/components/TradeOfferCard"
export { default as TrophyCase } from "../apps/frontend/app/components/TrophyCase"

// ── Modals ──────────────────────────────────────────────────────────────
export { default as AcceptConfirmModal } from "../apps/frontend/app/(authenticated)/league/[id]/components/AcceptConfirmModal"
export { default as ChangePasswordModal } from "../apps/frontend/app/(authenticated)/settings/components/ChangePasswordModal"
export { default as ConfirmDeleteModal } from "../apps/frontend/app/(authenticated)/league/[id]/settings/components/ConfirmDeleteModal"
export { default as ConfirmKickModal } from "../apps/frontend/app/(authenticated)/league/[id]/settings/components/ConfirmKickModal"
export { default as ConfirmStartSeasonModal } from "../apps/frontend/app/(authenticated)/league/[id]/components/ConfirmStartSeasonModal"
export { default as EndSeasonModal } from "../apps/frontend/app/(authenticated)/league/[id]/settings/components/EndSeasonModal"
export { default as PlaceBidModal } from "../apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal"
export { default as PlaceCounterpickBidModal } from "../apps/frontend/app/(authenticated)/league/[id]/components/PlaceCounterpickBidModal"

// ── Identity & brand ────────────────────────────────────────────────────
export { default as BrandLogo } from "../apps/frontend/app/components/BrandLogo"
export { default as DiscordIcon } from "../apps/frontend/app/components/icons/DiscordIcon"
export { default as GoogleIcon } from "../apps/frontend/app/components/icons/GoogleIcon"
export { default as NavLogo } from "../apps/frontend/app/components/navigation/NavLogo"
export {
  default as UserSearchResultItem,
  SelectedUserChip,
} from "../apps/frontend/app/(authenticated)/league/[id]/components/UserSearchResult"

// ── Landing ─────────────────────────────────────────────────────────────
export { default as MarketingHeader } from "../apps/frontend/app/components/landing/MarketingHeader"

// ── Settings primitives ─────────────────────────────────────────────────
export {
  LockedMessage,
  SectionHeader,
} from "../apps/frontend/app/(authenticated)/league/[id]/settings/components/shared"
