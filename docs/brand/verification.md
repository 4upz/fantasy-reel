# Brand package verification

Checked September 10, 2026. This record covers the candidate assets and standalone design review. No application component, runtime font configuration, or active icon metadata was changed.

## Fonts and typography

- Inspected the supplied variable font files: Bricolage supports weight 200–800, width 75–100, and optical size 12–96; DM Sans supports weight 100–1000 and optical size 9–40.
- The supplied DM Sans file has no `tnum` substitution and its digits have proportional advances. The proposal therefore uses Bricolage for numeric comparison roles.
- Shaped all ten Bricolage digits with HarfBuzz at weight 700, width 100, optical size 12, and `tnum`/`lnum` enabled. Every digit advances 623 font units.
- Wordmarks contain shaped vector outlines. Browser rendering does not depend on a user's installed fonts. The review loads its separate live-text specimens from the included local font files.
- The typography guide maps roles to inspected app components. Palette contrast calculations concern opaque color tokens, not a complete accessibility audit.

## Export integrity

- The package contains 28 image assets and `asset-index.json`. All SVGs parse as XML and contain no embedded raster image, script, or live text.
- All 13 PNG exports have the dimensions declared in their filenames. The app and maskable PNGs are opaque RGB images.
- The ICO contains three valid PNG payloads at 16, 32, and 48 pixels.
- Both 512px maskable exports keep essential foreground pixels within the safe circle: the furthest measured pixel is approximately 183.88px from center, inside the permitted 204.8px radius.
- The source drawings, font licenses, shaped wordmark data, and generation scripts are included. Rebuilding the assets produces identical file hashes.
- Local document and preview asset references resolve. Whitespace checks pass.

## Interactive review

Served [preview.html](preview.html) locally and inspected it in the Codex browser:

- Logo, type-system, and in-context panels fit viewport widths of 320px, 390px, and 1180px without horizontal document overflow.
- Logo and icon selectors change the rendered assets; all five logo treatments and both icon colorways are available. The SVG download link follows the selected treatment.
- Browser icons are shown at their native 16px, 32px, and 48px sizes. Platform masks are presentation examples; mobile source files remain square and opaque.
- Keyboard navigation changes the selected tab and moves focus with it. The Home key returns to the first tab.
- Local fonts load successfully. The inspected browser log contains no warnings or errors.

These are design specimens with illustrative league data, not connected app transactions. Application build, lint, and E2E suites were not run for this isolated static package. When the assets and type roles are adopted, verify actual navigation, forms, error recovery, long content, enlarged text, favicon refresh, and any installation flow as described in [the typography rollout guide](typography.md#rollout-and-acceptance).
