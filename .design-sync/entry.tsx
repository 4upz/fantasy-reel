// Design-system barrel for design-sync.
//
// Fantasy Reel is a Next.js app, not a published component package, so there
// is no `dist/` entry to bundle. This file is that entry: it re-exports the
// app's real, shipped presentational components under stable names. Nothing
// here reimplements a component — every export points at the component the
// app itself renders.
//
// Scope: presentational components only. Page-level containers that own data
// fetching and routing (DraftBoard, LeagueManager, DashboardClient, CinemaNav,
// MoviePicker, the settings form sections) are deliberately excluded — they
// are app wiring, not design-system parts.

// ── Context ─────────────────────────────────────────────────────────────
// Not a design-system component (excluded via componentSrcMap), but it must
// be a bundle export so cfg.provider can wrap every preview in it. Any
// component that renders WishlistToggle — DraftMovieCard, MovieQuickPreview —
// throws without it. The real app mounts it once in the authenticated layout.
export { WishlistProvider } from '../apps/frontend/hooks/useWishlist'

// ── Foundation ──────────────────────────────────────────────────────────
export { default as Avatar } from '../apps/frontend/app/components/Avatar'
export { LoadingSpinner } from '../apps/frontend/app/components/LoadingSpinner'
export { default as TomatometerScore } from '../apps/frontend/app/components/TomatometerScore'
export { default as DraftProgressRing } from '../apps/frontend/app/(authenticated)/league/[id]/components/DraftProgressRing'

// ── Feedback ────────────────────────────────────────────────────────────
export { FormError, FormSuccess, ErrorAlert } from '../apps/frontend/app/components/FormError'
export { default as ConnectionStatusIndicator } from '../apps/frontend/app/(authenticated)/league/[id]/components/ConnectionStatusIndicator'
export { default as MovieCardSkeleton } from '../apps/frontend/app/(authenticated)/movies/components/MovieCardSkeleton'
export { default as MovieGridSkeleton } from '../apps/frontend/app/(authenticated)/movies/components/MovieGridSkeleton'

// ── Movies ──────────────────────────────────────────────────────────────
export { default as MovieCard } from '../apps/frontend/app/(authenticated)/movies/components/MovieCard'
export { default as MovieGrid } from '../apps/frontend/app/(authenticated)/movies/components/MovieGrid'
export { default as MovieDetailModal } from '../apps/frontend/app/(authenticated)/movies/components/MovieDetailModal'
export { default as MovieSearchBar } from '../apps/frontend/app/(authenticated)/movies/components/MovieSearchBar'
export { default as MovieFilters } from '../apps/frontend/app/(authenticated)/movies/components/MovieFilters'
export { default as DraftMovieCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard'
export { default as DraftFilters } from '../apps/frontend/app/(authenticated)/league/[id]/components/DraftFilters'
export { default as MovieTimelineCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/MovieTimelineCard'

// ── League ──────────────────────────────────────────────────────────────
export { default as LeagueListItem } from '../apps/frontend/app/components/LeagueListItem'
export { default as BidCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/BidCard'
export { default as CounterpickBidCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickBidCard'
export { default as CounterpickPriorityList } from '../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickPriorityList'
export { default as TradeOfferCard } from '../apps/frontend/app/(authenticated)/league/[id]/components/TradeOfferCard'
export { default as ParticipantsList } from '../apps/frontend/app/(authenticated)/league/[id]/components/ParticipantsList'
export { default as PickOrderQueue } from '../apps/frontend/app/(authenticated)/league/[id]/components/PickOrderQueue'
export { default as StandingsSidebar } from '../apps/frontend/app/(authenticated)/league/[id]/components/StandingsSidebar'
export { default as TeamHeader } from '../apps/frontend/app/(authenticated)/league/[id]/components/TeamHeader'
export { default as MovieTimeline } from '../apps/frontend/app/(authenticated)/league/[id]/components/MovieTimeline'

// ── Modals ──────────────────────────────────────────────────────────────
export { default as AcceptConfirmModal } from '../apps/frontend/app/(authenticated)/league/[id]/components/AcceptConfirmModal'
export { default as PlaceBidModal } from '../apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal'
export { default as PlaceCounterpickBidModal } from '../apps/frontend/app/(authenticated)/league/[id]/components/PlaceCounterpickBidModal'
export { default as ConfirmDeleteModal } from '../apps/frontend/app/(authenticated)/league/[id]/settings/components/ConfirmDeleteModal'
export { default as ConfirmKickModal } from '../apps/frontend/app/(authenticated)/league/[id]/settings/components/ConfirmKickModal'
export { default as ChangePasswordModal } from '../apps/frontend/app/(authenticated)/settings/components/ChangePasswordModal'

// ── Identity & brand ────────────────────────────────────────────────────
export { default as NavLogo } from '../apps/frontend/app/components/navigation/NavLogo'
export {
  default as UserSearchResultItem,
  SelectedUserChip,
} from '../apps/frontend/app/(authenticated)/league/[id]/components/UserSearchResult'
export { default as DiscordIcon } from '../apps/frontend/app/components/icons/DiscordIcon'
export { default as GoogleIcon } from '../apps/frontend/app/components/icons/GoogleIcon'
// TMDbAttribution is deliberately NOT synced — see NOTES.md ("Deliberately
// excluded"). Its entire visual is a logo served from the app's public/ dir,
// which cannot ship in a component bundle, so the card would show a broken
// image in every design built with it.

// ── Landing ─────────────────────────────────────────────────────────────
export { default as HeroSection } from '../apps/frontend/app/components/landing/HeroSection'
export { default as MovieShowcase } from '../apps/frontend/app/components/landing/MovieShowcase'
export { default as ScoringReveal } from '../apps/frontend/app/components/landing/ScoringReveal'
export { default as DraftTicker } from '../apps/frontend/app/components/landing/DraftTicker'
export { default as CTAFooter } from '../apps/frontend/app/components/landing/CTAFooter'
// SiteFooter is NOT synced — it is a thin wrapper around TMDbAttribution, so it
// inherits the same missing public/ logo problem. See NOTES.md.

// ── Settings primitives ─────────────────────────────────────────────────
export {
  SectionHeader,
  LockedMessage,
} from '../apps/frontend/app/(authenticated)/league/[id]/settings/components/shared'
