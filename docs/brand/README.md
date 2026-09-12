# Fantasy Reel brand package

The active Fantasy Reel identity: a gold film-strip speech-bubble mark, outlined soft-white Bricolage wordmark, and the shared Bricolage/DM Sans typography system. Approved assets live in `apps/frontend/public/brand/v1/`; the app uses the primary logo, charcoal mobile icons, and simplified browser mark.

Open [the interactive review](preview.html) to compare five logo treatments, two icon colorways, browser icons at actual size, the complete type scale, and representative league/form specimens. It uses local font files and works without external font services. The [typography guide](typography.md) is the canonical role reference. The specimen's [typography.css](typography.css) imports [the app's role stylesheet](../../apps/frontend/app/typography.css), so the displayed scale stays synchronized with the product.

## Active combination and alternatives

- [Primary logo](../../apps/frontend/public/brand/v1/logo-dark.svg): gold film-conversation mark with soft-white Bricolage wordmark.
- [Charcoal mobile icon](../../apps/frontend/public/brand/v1/app-charcoal-512.png): the app's default home-screen colorway.
- [Compact browser icon](../../apps/frontend/public/brand/v1/favicon.svg): a separately drawn, simplified mark with broad cuts and pixel-aligned geometry.
- [Gold mobile alternative](../../apps/frontend/public/brand/v1/app-gold-512.png): greater home-screen contrast, using the same vector geometry.

The mark combines a curled film strip and a speech-bubble tail. The full drawing has three upper and two lower perforations. The micro drawing has two larger perforations on each band and removes the fine ribbon seam. They are intentionally optically different; do not shrink the full logo into a favicon.

The wordmarks are real vector outlines shaped from Bricolage Grotesque with kerning. Primary: weight 700, width 96, optical size 48. Compact: 750, 88, 48. They need no installed font or network request to render. Preserve the outlined lettering and aspect ratio when placing the logo; ordinary interface text uses the live font families.

## Asset inventory

All paths in this table are relative to [the asset directory](../../apps/frontend/public/brand/v1/).

| File(s) | Purpose |
| --- | --- |
| `logo-dark.svg` | Primary horizontal logo on dark surfaces |
| `logo-compact-dark.svg` | More compressed lettering for narrower placements |
| `logo-gold.svg` | One-color gold horizontal logo |
| `logo-light.svg` | One-color ink horizontal logo for light backgrounds |
| `logo-stacked-dark.svg` | Mark above wordmark for spacious centered placements |
| `mark-gold.svg`, `mark-white.svg`, `mark-ink.svg` | Standalone transparent symbol for navigation and branding |
| `app-{charcoal,gold}.svg` | Full-bleed, opaque square icon masters |
| `app-{charcoal,gold}-{180,192,512,1024}.png` | Opaque RGB platform-sized exports |
| `maskable-{charcoal,gold}.svg`, `maskable-{charcoal,gold}-512.png` | Separate icons with extra room for platform masks |
| `favicon.svg`, `favicon-{16,32,48}.png`, `favicon.ico` | Browser icon; ICO includes all three PNG sizes |
| `pinned-tab.svg` | Black silhouette with transparent openings for monochrome masking |
| `asset-index.json` | Machine-readable inventory and default paths |

Mobile files have square corners and opaque backgrounds. The review applies corner or circle masks only to show possible platform presentation. Do not bake rounded transparent corners into the mobile source. Maskable exports preserve all essential pixels inside the central safe circle with radius 40% of the canvas, following the [Web App Manifest icon-mask specification](https://www.w3.org/TR/appmanifest/#icon-masks).

The [high-fidelity charcoal](concepts/charcoal.png) and [gold](concepts/gold.png) studies were generated with the built-in image-generation tool. They explore the visual direction and may contain small color/curve differences. Installable exports derive from the consistent editable [vector master](source/mark.svg), not from a scaled screenshot. The exact generation prompts are retained in [concept provenance](concepts/prompts.md).

## App integration

- The app supports [System, Light, and Dark themes](themes.md), with shared typography and approved light/dark logo assets.
- Navigation uses the approved horizontal SVG lockup and symbol through the shared brand component. Preserve the link's accessible name, focus behavior, and aspect ratio. Do not repeat the wordmark as adjacent text or recreate the symbol with CSS.
- [app/icon.svg](../../apps/frontend/app/icon.svg) uses the simplified drawing; [app/favicon.ico](../../apps/frontend/app/favicon.ico) supplies the browser fallback. [app/apple-icon.png](../../apps/frontend/app/apple-icon.png) is the opaque 180px charcoal icon. Keep file-based metadata and explicit layout metadata consistent. See [Next's icon conventions](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons).
- The manifest uses separate `any` entries for the charcoal 192px/512px icons and a `maskable` entry for its padded 512px icon. Icon metadata does not by itself add offline support or a native app.
- Fonts load locally from `app/fonts/bricolage.woff2` and `app/fonts/dm-sans.woff2` through `next/font/local`. Use [the typography roles](typography.md#role-scale), including Bricolage's fixed optical-size numeric setting. Keep the global error boundary's system-font recovery independent of brand-font loading.
- Design-sync copies these same WOFF2 files and embeds approved `/brand/v1/` SVG routes for its standalone renderer; see [the sync notes](../../.design-sync/NOTES.md). Local preset changes do not publish an external design project.

When changing the identity, regenerate exports from the source files below and verify both normal and masked icons at their actual presentation sizes. The asset builder also updates the active app icon copies. Keep the micro drawing distinct from the full mark.

## Local review and regeneration

From the repository root, serve the review on loopback:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open [the local specimen](http://127.0.0.1:8767/docs/brand/preview.html). It serves the checked-in brand assets and shared typography. Application testing uses `npm run dev` as described in [AGENTS.md](../../AGENTS.md).

The SVG master drawings and outlined wordmark data are checked in. Rebuild the SVG/PNG/ICO exports and active app icon copies with the app's existing Sharp dependency:

```sh
npm run brand:assets
```

To regenerate wordmark outlines after intentionally changing their typography, use Python with `fonttools==4.65.0` and `uharfbuzz==0.56.1`, then rebuild the assets:

```sh
python docs/brand/source/build-wordmarks.py
npm run brand:assets
```

To regenerate the runtime WOFF2 files from the licensed TTF sources, use Python with `fonttools` and `brotli`, then refresh the standalone preset:

```sh
python docs/brand/source/build-fonts.py
node .design-sync/build-styles.mjs
```

The source fonts came from the official Google Fonts repositories: [Bricolage Grotesque](https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque) and [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans). Their licenses are included as [Bricolage OFL](source/OFL.txt) and [DM Sans OFL](source/OFL-DM-Sans.txt). The TTF files retain the reproducible source. Runtime WOFF2 files in `app/fonts/` are converted from these fonts; keep their variable axes, supported glyphs, and licenses when regenerating. The static specimen and design-sync use those runtime files rather than independent font downloads.

## Verification scope

Completed checks and any remaining limitations are recorded in [verification.md](verification.md). Keep asset-format, static-specimen, application-flow, and platform-installation verification distinct; a successful asset build does not establish all of them.
