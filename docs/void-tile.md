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
