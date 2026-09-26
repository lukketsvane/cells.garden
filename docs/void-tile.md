# Void background tile

The site consumes `src/assets/void_tile.png`, a native 32 by 32 PNG, through
`.garden-canvas-viewport::before` in `src/core/void-tile.css`. Its alpha forms
the repeating pattern; CSS supplies the theme color.

Keep the asset at 32 × 32 with transparency. Replacing
`src/assets/void_tile.png` changes the deployed pattern after the normal build
and deployment flow.

For a local Inspector-only experiment, select
`.garden-canvas-viewport::before` and replace `mask-image` and
`-webkit-mask-image`. Reloading restores the deployed asset.

## Preview and publish

Run `npm run dev` and open `/void-preview/`. Select your exported PNG to
check its native-size repetition and alpha mask with different theme colours.
The preview validates the PNG, its 32 × 32 dimensions and transparency. It
uses only local browser memory: it does not upload, persist or publish a file.
The same preview is available at `https://cells.garden/void-preview/`.

When approved, replace `src/assets/void_tile.png`, run the checks in
`AGENTS.md` and `npm run test:unit`, and review the result on `dev` before
promoting to `main`. The asset ships in all three distributions. The unit
suite checks its dimensions and alpha channel, and `npm run test:seo`
checks the preview's valid/invalid-file paths.

Design files remain references only. There is no design-tool token, staging
queue or automated publish link to restore. The manual approval and normal
repository deployment path are the beta asset workflow.
