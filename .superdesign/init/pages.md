# Page Dependency Trees

## Landing Page `/`
**File:** `apps/frontend/app/page.tsx`

### Dependency Tree:
```
apps/frontend/app/page.tsx (RSC)
├── apps/frontend/app/components/landing/HeroSection.tsx
│   ├── apps/frontend/app/components/navigation/NavLogo.tsx
│   │   └── apps/frontend/app/components/BrandLogo.tsx
│   └── apps/frontend/app/components/landing/DraftTicker.tsx
│       └── apps/frontend/app/components/landing/data.ts (TickerEntry type)
├── apps/frontend/app/components/landing/UiPreview.tsx ('use client')
├── apps/frontend/app/components/landing/ScoringReveal.tsx
│   └── apps/frontend/app/components/landing/data.ts (SCORING_EXAMPLES, ScoringExample type)
├── apps/frontend/app/components/landing/MovieShowcase.tsx ('use client')
│   └── types/index.ts (TMDbSearchResult type)
├── apps/frontend/app/components/landing/CTAFooter.tsx
├── apps/frontend/app/components/landing/SiteFooter.tsx
│   └── apps/frontend/components/TMDbAttribution.tsx
├── apps/frontend/app/components/landing/data.ts (generateTickerEntries, FALLBACK_MOVIES)
└── types/index.ts (TMDbSearchResult type)
```

### Required context files for this page:
- `apps/frontend/app/page.tsx`
- `apps/frontend/app/components/landing/HeroSection.tsx`
- `apps/frontend/app/components/landing/UiPreview.tsx`
- `apps/frontend/app/components/landing/ScoringReveal.tsx`
- `apps/frontend/app/components/landing/MovieShowcase.tsx`
- `apps/frontend/app/components/landing/CTAFooter.tsx`
- `apps/frontend/app/components/landing/SiteFooter.tsx`
- `apps/frontend/app/components/landing/DraftTicker.tsx`
- `apps/frontend/app/components/landing/data.ts`
- `apps/frontend/app/components/navigation/NavLogo.tsx`
- `apps/frontend/app/globals.css`
- `apps/frontend/app/layout.tsx`

- `apps/frontend/app/components/BrandLogo.tsx`
- `apps/frontend/app/typography.css`
- `docs/brand/typography.md`
- `docs/brand/README.md`

BrandLogo uses the approved assets under `apps/frontend/public/brand/v1/`.
Root font loading uses the local WOFF2 files in `apps/frontend/app/fonts/`.
