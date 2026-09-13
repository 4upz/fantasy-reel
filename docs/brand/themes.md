# Appearance themes

Fantasy Reel supports **System**, **Light**, and **Dark**. System is the default
and follows changes to the device's color scheme while the app is open. A manual
choice overrides the device setting until System is selected again.

The account menu and Account settings → Appearance provide the selector on
desktop and mobile. Signed-out pages also expose a theme selector. Preferences
are saved in this browser on this device and synchronize across open tabs;
they are not part of the user's server profile. When browser storage is
unavailable, the selector still works for the current visit.

The account menu and Settings share a compact, text-only segmented control with
44px touch targets. A gold border identifies the selected option; an additional
outer outline identifies keyboard focus. Keep the explanatory copy in Settings.
The marketing navigation reveals this same control from a quiet theme icon on
desktop. On mobile, the brand symbol, How to play, and Sign up stay visible in a
single header row. The navigation menu contains Sign in and space for additional
links, with the theme choices below them.
The selection indicator slides between options over 200ms. It appears in its
saved position after initialization and moves instantly when reduced motion is
preferred.

## Implementation

- [`utils/theme.ts`](../../apps/frontend/utils/theme.ts) defines the preference
  values, versioned storage key, and initialization script.
- [`ThemeScript`](../../apps/frontend/components/theme/ThemeScript.tsx) applies
  the resolved theme in the document head before the first paint. The root
  layout and self-contained global error boundary both use it.
- [`ThemeProvider`](../../apps/frontend/components/theme/ThemeProvider.tsx)
  handles interactive updates, device changes, and storage events.
- [`globals.css`](../../apps/frontend/app/globals.css) retains the Cinematic
  Dark palette and overrides semantic tokens for `html[data-theme="light"]`.
  The light palette uses a light gray canvas, white cards, dark text, and a
  deeper gold for readable controls. Fonts, role classes, and layout stay shared.

Use semantic tokens for page surfaces, text, statuses, shadows, and modal
overlays. `foreground-inverse` is the label color on theme-dependent gold and
status fills. Fixed-color artwork and crimson fills need their own contrasting
label color; do not use `text-background` as a general button text color.
Use the approved light and dark logo assets through `BrandLogo`.

[`theme.spec.ts`](../../apps/frontend/e2e/tests/theme/theme.spec.ts) covers device
changes, manual preferences, persistence, initial rendering, storage failure,
tab synchronization, and desktop/mobile account controls. Run browser tests
using the repository's [E2E guide](../E2E_TESTING_STRATEGY.md).
