# Shared UI Components

Typography follows [the active role guide](../../docs/brand/typography.md);
branding follows [the approved assets](../../docs/brand/README.md).

## Brand and navigation
- `apps/frontend/app/components/BrandLogo.tsx` — approved vector lockup/symbol
- `apps/frontend/app/components/navigation/NavLogo.tsx` — accessible navigation link

## Avatar
**File:** `apps/frontend/app/components/Avatar.tsx`
User/team avatar circle with gold border, uses initials or image.

## FormError
**File:** `apps/frontend/app/components/FormError.tsx`
Error display using `.alert-error` class.

## LoadingSpinner
**File:** `apps/frontend/app/components/LoadingSpinner.tsx`
Spinning loader with `border-gold` accent.

## TMDbAttribution
**File:** `apps/frontend/components/TMDbAttribution.tsx`
TMDb logo attribution for movie data, used in footer.

## NotificationBell
**File:** `apps/frontend/components/NotificationBell.tsx`
Notification bell icon with unread count badge.

## Auth Components
- `apps/frontend/app/components/auth/DiscordLoginButton.tsx` — Discord OAuth button
- `apps/frontend/app/components/auth/GoogleLoginButton.tsx` — Google OAuth button

## Icon Components
- `apps/frontend/app/components/icons/DiscordIcon.tsx`
- `apps/frontend/app/components/icons/GoogleIcon.tsx`

## Landing Page Components
- `apps/frontend/app/components/landing/HeroSection.tsx` — Full-screen hero with tagline, CTA, and ticker
- `apps/frontend/app/components/landing/UiPreview.tsx` — "How it works" section with value props + screenshot
- `apps/frontend/app/components/landing/ScoringReveal.tsx` — Scoring system showcase with movie cards
- `apps/frontend/app/components/landing/MovieShowcase.tsx` — Horizontal scrolling movie poster carousel
- `apps/frontend/app/components/landing/CTAFooter.tsx` — Final CTA with glass panel
- `apps/frontend/app/components/landing/SiteFooter.tsx` — TMDb attribution footer
- `apps/frontend/app/components/landing/DraftTicker.tsx` — Marquee ticker of draft activity
- `apps/frontend/app/components/landing/data.ts` — Fictional users, snarky comments, scoring examples, fallback movies

## Dashboard Components
- `apps/frontend/app/components/DashboardClient.tsx`
- `apps/frontend/app/components/DashboardSidebar.tsx`
- `apps/frontend/app/components/LeagueListItem.tsx`
- `apps/frontend/app/components/LeagueManager.tsx`
- `apps/frontend/app/components/CreateLeagueModal.tsx`
- `apps/frontend/app/components/PendingInvitations.tsx`
