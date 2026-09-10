# Layouts and identity

Use the current source files below. This preset intentionally links to them
instead of copying implementations that drift when the app changes.

## Root layout

[app/layout.tsx](../../apps/frontend/app/layout.tsx) loads the local Bricolage
Grotesque and DM Sans WOFF2 files through `next/font/local`, using
`--font-bricolage` and `--font-dm-sans`. It imports the shared global styles and
mounts the app providers and observability components.

[globals.css](../../apps/frontend/app/globals.css) owns colors and component
styles; [typography.css](../../apps/frontend/app/typography.css) owns `type-*`
roles. See [the active guide](../../docs/brand/typography.md) for usage.

Browser/mobile icons use file-based app metadata (`icon.svg`, `favicon.ico`,
`apple-icon.png`) and the approved charcoal `any`/`maskable` manifest assets.
Do not restore an Apple SVG URL or separate font service.

## Navigation logo

[NavLogo.tsx](../../apps/frontend/app/components/navigation/NavLogo.tsx) wraps
[BrandLogo.tsx](../../apps/frontend/app/components/BrandLogo.tsx) in the
navigation link. Preserve the link destination, accessible name, keyboard
focus, and vector aspect ratio. The approved lockup uses a matte-gold curled
film-strip speech bubble and outlined soft-white wordmark; icon-only placements
reuse the matching symbol. [Brand use](../../docs/brand/README.md).

## Navigation system

Authenticated pages use
[SideNav.tsx](../../apps/frontend/app/components/navigation/SideNav.tsx),
[ProfileMenu.tsx](../../apps/frontend/app/components/navigation/ProfileMenu.tsx),
and the league navigation components. The landing page has its own logo and
authentication links. Inspect both desktop and mobile navigation states when
changing typography; keep functional labels at least 12px.

## Error recovery

[error.tsx](../../apps/frontend/app/error.tsx) and
[global-error.tsx](../../apps/frontend/app/global-error.tsx) share the same
visual hierarchy. The global boundary must retain self-contained styling and a
system-font fallback because it replaces the root layout.
