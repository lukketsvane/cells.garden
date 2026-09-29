# Void background tile

The site consumes `src/assets/void_tile.png`, a native 32 by 32 PNG, through
`.garden-canvas-viewport` in `src/core/void-tile.css`. Its original colours and
transparency form the repeating pattern. An opaque PNG is valid artwork too;
using it as an alpha mask would flatten the design into a solid colour.

Keep the asset at 32 × 32 without changing the artist's pixels. Replacing
`src/assets/void_tile.png` changes the deployed pattern after the normal build
and deployment flow.

For a local Inspector-only experiment, select
`.garden-canvas-viewport` and replace `background-image`.
Reloading restores the deployed asset.

## Preview and publish

Run `npm run dev` and open `/void-preview/`. Select your exported PNG to
check its native-size repetition and original colours against different backgrounds.
The preview validates the PNG, its 32 × 32 dimensions and visible pixels. It
uses only local browser memory: it does not upload, persist or publish a file.
The same preview is available at `https://dev.cells.garden/void-preview/`.

When approved, replace `src/assets/void_tile.png`, run the checks in
`AGENTS.md` and `npm run test:unit`, and review the result on `dev` before
promoting to `main`. The asset ships in all three distributions. The unit
suite checks its dimensions and colour-preserving rendering, and `npm run test:seo`
checks the preview's valid/invalid-file paths.

Design files remain references only. There is no design-tool token, staging
queue or automated publish link to restore. The manual approval and normal
repository deployment path are the beta asset workflow.
