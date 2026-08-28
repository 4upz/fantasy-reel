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
export { WishlistProvider } from '../apps/frontend/hooks/useWishlist'

// ── Foundation ──────────────────────────────────────────────────────────
export { default as Avatar } from '../apps/frontend/app/components/Avatar'
export { default as DraftProgressRing } from '../apps/frontend/app/(authenticated)/league/[id]/components/DraftProgressRing'
export { LoadingSpinner } from '../apps/frontend/app/components/LoadingSpinner'
export { default as TomatometerScore } from '../apps/frontend/app/components/TomatometerScore'

// ── Feedback ────────────────────────────────────────────────────────────
export { default as ConnectionStatusIndicator } from '../apps/frontend/app/(authenticated)/league/[id]/components/ConnectionStatusIndicator'
export { ErrorAlert, FormError, FormSuccess } from '../apps/frontend/app/components/FormError'
export { default as MovieCardSkeleton } from '../apps/frontend/app/(authenticated)/movies/components/MovieCardSkeleton'
export { default as MovieGridSkeleton } from '../apps/frontend/app/(authenticated)/movies/components/MovieGridSkeleton'

// ── Movies ──────────────────────────────────────────────────────────────
export { default as DraftFilters } from '../apps/frontend/app/(authenticated)/league/[id]/components/DraftFilters'
export { default as DraftMovieCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard'
export { default as MovieCard } from '../apps/frontend/app/(authenticated)/movies/components/MovieCard'
export { default as MovieDetailModal } from '../apps/frontend/app/(authenticated)/movies/components/MovieDetailModal'
export { default as MovieFilters } from '../apps/frontend/app/(authenticated)/movies/components/MovieFilters'
export { default as MovieGrid } from '../apps/frontend/app/(authenticated)/movies/components/MovieGrid'
export { default as MovieSearchBar } from '../apps/frontend/app/(authenticated)/movies/components/MovieSearchBar'
export { default as MovieTimelineCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/MovieTimelineCard'

// ── League ──────────────────────────────────────────────────────────────
export { default as BidCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/BidCard'
export { default as BidPriorityList } from '../apps/frontend/app/(authenticated)/league/[id]/components/BidPriorityList'
export { default as BidWeekTimeline } from '../apps/frontend/app/(authenticated)/league/[id]/components/BidWeekTimeline'
export { default as CounterpickBidCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickBidCard'
export { default as CounterpickPriorityList } from '../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickPriorityList'
export { default as LeagueListItem } from '../apps/frontend/app/components/LeagueListItem'
export { default as MovieTimeline } from '../apps/frontend/app/(authenticated)/league/[id]/components/MovieTimeline'
export { default as ParticipantsList } from '../apps/frontend/app/(authenticated)/league/[id]/components/ParticipantsList'
export { default as PickOrderQueue } from '../apps/frontend/app/(authenticated)/league/[id]/components/PickOrderQueue'
export { default as PriorityList } from '../apps/frontend/app/(authenticated)/league/[id]/components/PriorityList'
export { default as StandingsSidebar } from '../apps/frontend/app/(authenticated)/league/[id]/components/StandingsSidebar'
export { default as TeamHeader } from '../apps/frontend/app/(authenticated)/league/[id]/components/TeamHeader'
export { default as TradeOfferCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/TradeOfferCard'

// ── Modals ──────────────────────────────────────────────────────────────
export { default as AcceptConfirmModal } from '../apps/frontend/app/(authenticated)/league/[id]/components/AcceptConfirmModal'
export { default as ChangePasswordModal } from '../apps/frontend/app/(authenticated)/settings/components/ChangePasswordModal'
export { default as ConfirmDeleteModal } from '../apps/frontend/app/(authenticated)/league/[id]/settings/components/ConfirmDeleteModal'
export { default as ConfirmKickModal } from '../apps/frontend/app/(authenticated)/league/[id]/settings/components/ConfirmKickModal'
export { default as PlaceBidModal } from '../apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal'
export { default as PlaceCounterpickBidModal } from '../apps/frontend/app/(authenticated)/league/[id]/components/PlaceCounterpickBidModal'

// ── Identity & brand ────────────────────────────────────────────────────
export { default as DiscordIcon } from '../apps/frontend/app/components/icons/DiscordIcon'
export { default as GoogleIcon } from '../apps/frontend/app/components/icons/GoogleIcon'
export { default as NavLogo } from '../apps/frontend/app/components/navigation/NavLogo'
export {
  default as UserSearchResultItem,
  SelectedUserChip,
} from '../apps/frontend/app/(authenticated)/league/[id]/components/UserSearchResult'

// ── Landing ─────────────────────────────────────────────────────────────
export { default as CTAFooter } from '../apps/frontend/app/components/landing/CTAFooter'
export { default as DraftTicker } from '../apps/frontend/app/components/landing/DraftTicker'
export { default as HeroSection } from '../apps/frontend/app/components/landing/HeroSection'
export { default as MovieShowcase } from '../apps/frontend/app/components/landing/MovieShowcase'
export { default as ScoringReveal } from '../apps/frontend/app/components/landing/ScoringReveal'

// ── Settings primitives ─────────────────────────────────────────────────
export {
  LockedMessage,
  SectionHeader,
} from '../apps/frontend/app/(authenticated)/league/[id]/settings/components/shared'
