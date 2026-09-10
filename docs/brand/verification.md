# Brand rollout verification

Checked September 10, 2026. The approved identity and typography are active in the application, agent instructions, and local design presets. This record distinguishes the original asset checks from application and integration checks.

## Fonts and typography

- Inspected the supplied variable font files: Bricolage supports weight 200–800, width 75–100, and optical size 12–96; DM Sans supports weight 100–1000 and optical size 9–40.
- The supplied DM Sans file has no `tnum` substitution and its digits have proportional advances. The system therefore uses Bricolage for numeric comparison roles.
- Shaped all ten Bricolage digits with HarfBuzz at weight 700, width 100, optical size 12, and `tnum`/`lnum` enabled. Every digit advances 623 font units.
- Wordmarks contain shaped vector outlines. Browser rendering does not depend on a user's installed fonts. The review loads its separate live-text specimens from the included local font files.
- Converted both licensed TTF sources to local variable WOFF2 files. Glyph maps, advance widths, and variable-axis bounds match their source fonts. The design-sync copies match the app files byte for byte.
- Inspected actual application font loading: both local WOFF2 files are preloaded, headings resolve to Bricolage, and reading text and controls resolve to DM Sans. Numeric roles use Bricolage with optical size 12, width 100, and tabular lining digits; quick bid amount buttons retain this setting through the button styles.
- The app, standalone review, and design-sync build share `app/typography.css`. Palette contrast calculations concern opaque color tokens, not a complete accessibility audit.

## Export integrity

- The package contains 28 image assets and `asset-index.json`. All SVGs parse as XML and contain no embedded raster image, script, or live text.
- All 13 PNG exports have the dimensions declared in their filenames. The app and maskable PNGs are opaque RGB images.
- The ICO contains three valid PNG payloads at 16, 32, and 48 pixels.
- Both 512px maskable exports keep essential foreground pixels within the safe circle: the furthest measured pixel is approximately 183.88px from center, inside the permitted 204.8px radius.
- The source drawings, font licenses, shaped wordmark data, and generation scripts are included. Rebuilding the assets produces identical file hashes.
- Active `app/icon.svg`, `app/favicon.ico`, and `app/apple-icon.png` match the approved exports. The asset builder maintains these copies.
- Inspected rendered application metadata for the SVG icon, ICO fallback, 180px Apple icon, and manifest. An unauthenticated manifest request returns HTTP 200 with separate 192px/512px `any` icons and a padded 512px `maskable` icon.
- Local document and preview asset references resolve. Whitespace checks pass.

## Standalone interactive review

Served [preview.html](preview.html) locally and inspected it in the Codex browser:

- Logo, type-system, and in-context panels fit viewport widths of 320px, 390px, and 1180px without horizontal document overflow.
- Logo and icon selectors change the rendered assets; all five logo treatments and both icon colorways are available. The SVG download link follows the selected treatment.
- Browser icons are shown at their native 16px, 32px, and 48px sizes. Platform masks are presentation examples; mobile source files remain square and opaque.
- Keyboard navigation changes the selected tab and moves focus with it. The Home key returns to the first tab.
- Local fonts load successfully. The inspected browser log contains no warnings or errors.

These original design specimens use illustrative league data. The application checks below were run separately after adoption.

## Application checks

Used an isolated copy of the current app and local environment configuration, started freshly with `PORT=3011 npm run dev`. The user's existing server was left running. Tests used local Supabase fixtures and their normal setup/teardown; no database reset was performed.

- `npm run lint` passed without warnings or errors.
- `npx tsc --noEmit --incremental false` in `apps/frontend` passed.
- `npm run build` passed, including Next's lint/type checks and generation of 32 static pages.
- `E2E_BASE_URL=http://localhost:3011 ./scripts/run-e2e-tests.sh --project=chromium --workers=4` passed: **153 passed, 29 existing skips, zero failures or flaky retries**. Two E2E files were updated for sentence-case headings and a unique accessible selector for the empty-dashboard create action.
- After the enlarged-text layout fixes, reran `e2e/tests/bidding/place-bid.spec.ts`: 10 passed (including setup/teardown), one existing skip, zero failures. Also reran the real recipient acceptance case in `e2e/tests/trading/trade-flow.spec.ts`: three passed including setup/teardown, zero failures. Lint and standalone TypeScript checks were repeated on the final sources.
- Inspected the real landing page, login, dashboard, expanded/collapsed navigation, mobile drawer, standings, and roster. Checked widths of 320px, 390px, and 1280px; the inspected mobile screens have no horizontal document overflow. Fixed intrinsic grid sizing and long league-title wrapping after finding dashboard overflow.
- Inspected the actual bid, counterpick, and trade-confirmation components in a temporary local harness with long movie/team names and accented text. The harness uses inert callbacks rather than real transactions. At 320px, quick amounts update the bid field, an amount above the available budget disables submission, and the long trade confirmation scrolls to its action buttons and dismisses correctly.
- Repeated the three-dialog check at 320px with the root text size doubled to 32px and increased text spacing (1.5 line height, 2em paragraph spacing, .12em letter spacing, .16em word spacing). Fixed scrolling, gutters, and wrapping where controls were clipped. The final dialog panels have no horizontal overflow; their action buttons remain reachable by scrolling, and trade cancellation works. This is text-resizing verification in a local harness, not a physical mobile-device test.

## Design presets and future edits

- `node .design-sync/build-styles.mjs` passes using the app's installed Tailwind/PostCSS dependencies. It compiles shared app styles, copies the runtime fonts, and embeds the approved SVG routes for standalone previews.
- The complete design-sync component barrel bundles successfully. Primary, compact, and symbol-only logo previews render the correct embedded SVGs. Offline movie shim responses were checked for their supported browse/search cases and explicit unsupported-detail error.
- AGENTS.md, CLAUDE.md, frontend documentation, Superdesign context, and design-sync conventions point to the active guide. Local Markdown references were checked. Future role changes should update the canonical stylesheet and guide together, then rebuild the presets.
- The external design-sync converter is unavailable in this environment; no external design project was published. Its drift checker still reports eight omissions already present on the starting commit: Chip, CounterpickMark, DateTimeField, FranchiseHistoryPanel, FranchiseSummary, OfferExpiryPicker, ProfileMenu, and TradeConfigSection. This rollout does not suppress those baseline omissions.

## Remaining limits

No physical iOS/Android installation or browser-cache migration was exercised. The manifest and icon checks verify exported files and served metadata, not offline support, a native app, or every platform's installation presentation. The inspected screens and automated suite provide targeted coverage; they are not a full accessibility audit. Keep the acceptance criteria in [the typography guide](typography.md#rollout-and-acceptance) when extending the system.
