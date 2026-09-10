# Fantasy Reel brand package

September 2026 candidate assets and typography proposal. The existing app's font loading, navigation, favicon and metadata are unchanged. The candidate assets are under `apps/frontend/public/brand/v1/` so they can be adopted without relocating files. This is a design review package, not a completed app rollout.

Open [the interactive review](preview.html) to compare five logo treatments, two icon colorways, browser icons at actual size, the complete type scale, and representative league/form specimens. It uses local font files and works without external font services. The [typography guide](typography.md) maps the proposed roles to the current app. [typography.css](typography.css) implements those roles under `.fr-type-system` for the review; it is not imported by the app.

## Recommended combination

- [Primary logo](../../apps/frontend/public/brand/v1/logo-dark.svg): gold film-conversation mark with soft-white Bricolage wordmark.
- [Charcoal mobile icon](../../apps/frontend/public/brand/v1/app-charcoal-512.png): closest match to the app's current dark surfaces.
- [Compact browser icon](../../apps/frontend/public/brand/v1/favicon.svg): a separately drawn, simplified mark with broad cuts and pixel-aligned geometry.
- [Gold mobile alternative](../../apps/frontend/public/brand/v1/app-gold-512.png): greater home-screen contrast, using the same vector geometry.

The mark combines a curled film strip and a speech-bubble tail. The full drawing has three upper and two lower perforations. The micro drawing has two larger perforations on each band and removes the fine ribbon seam. They are intentionally optically different; do not shrink the full logo into a favicon.

The wordmarks are real vector outlines shaped from Bricolage Grotesque with kerning. Primary: weight 700, width 96, optical size 48. Compact: 750, 88, 48. They need no installed font or network request to render. They are a refined candidate family, not a claim of a commissioned custom typeface or a trademark clearance.

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
| `asset-index.json` | Machine-readable candidate inventory and recommended paths |

Mobile files have square corners and opaque backgrounds. The review applies corner or circle masks only to show possible platform presentation. Do not bake rounded transparent corners into the mobile source. Maskable exports preserve all essential pixels inside the central safe circle with radius 40% of the canvas, following the [Web App Manifest icon-mask specification](https://www.w3.org/TR/appmanifest/#icon-masks).

The [high-fidelity charcoal](concepts/charcoal.png) and [gold](concepts/gold.png) studies were generated with the built-in image-generation tool. They explore the visual direction and may contain small color/curve differences. Installable exports derive from the consistent editable [vector master](source/mark.svg), not from a scaled screenshot. The exact generation prompts are retained in [concept provenance](concepts/prompts.md).

## Adoption notes

After selecting the preferred treatment:

1. Use the chosen horizontal SVG in `NavLogo`, preserving its link, accessible name, focus behavior and responsive layout. Use `mark-gold.svg` for icon-only navigation. Avoid repeating the wordmark as both image and adjacent text.
2. Replace the current `apps/frontend/app/icon.svg` with the candidate `favicon.svg`; add the candidate `favicon.ico` at `apps/frontend/app/favicon.ico` for the root browser fallback.
3. Replace the current Apple SVG setup with `app-charcoal-180.png` (or the gold version) at `apps/frontend/app/apple-icon.png`. Next's image-file convention supports PNG/JPEG for `apple-icon`, whereas SVG is supported for the general `icon` convention. Remove or update the existing explicit `metadata.icons` URLs in `app/layout.tsx` so they do not continue pointing to `/apple-icon.svg`. See [Next's icon conventions](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons); the supported extensions were also checked against this repository's installed Next 15.3.8 implementation.
4. If the app adopts a web manifest, use separate `any` and `maskable` entries. The example below is an icon-entry fragment, not a complete manifest or a claim of PWA installability. Icons alone do not implement offline behavior or a native app.
5. Migrate type roles in coherent screens using [the rollout map](typography.md#rollout-and-acceptance). A global font replacement would unintentionally change bid amounts, avatars and controls currently styled as display text. Keep error recovery independent of font-loading success.

```json
{
  "icons": [
    { "src": "/brand/v1/app-charcoal-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/brand/v1/app-charcoal-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/brand/v1/maskable-charcoal-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## Local review and regeneration

From the repository root, serve the review on loopback:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8767/docs/brand/preview.html`. This is a static asset review, not the app's development server. App-rollout testing must use `npm run dev` as described in [AGENTS.md](../../AGENTS.md).

The SVG master drawings and outlined wordmark data are checked in. To rebuild the delivered SVG/PNG/ICO files with the app's existing Sharp dependency:

```sh
node docs/brand/source/build-assets.mjs
```

To regenerate wordmark outlines after intentionally changing their typography, use Python with `fonttools==4.65.0` and `uharfbuzz==0.56.1`, then rebuild the assets:

```sh
python docs/brand/source/build-wordmarks.py
node docs/brand/source/build-assets.mjs
```

The source fonts came from the official Google Fonts repositories: [Bricolage Grotesque](https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque) and [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans). Their licenses are included as [Bricolage OFL](source/OFL.txt) and [DM Sans OFL](source/OFL-DM-Sans.txt). These local source fonts support the review and reproduction; they do not add new runtime fonts to the existing app.

## Verification scope

Asset and review checks are recorded in [verification.md](verification.md). The complete application's navigation, transaction flows, browser icon refresh and installation behavior still need verification when this package is integrated.
