# Void background tile

The site consumes `src/assets/void_tile.png`, a native 32 by 32 PNG, through
`.garden-canvas-viewport::before` in `src/core/void-tile.css`. Its alpha forms
the repeating pattern; CSS supplies the theme color.

## Canonical Figma source

https://www.figma.com/design/0cPckxpkUOpFeL1Dx7VHCg/cells.garden-MASTER?node-id=4-924

- Source component: `4:924`
- Export frame: `4:925`
- Native size: 32 × 32
- Repo destination: `src/assets/void_tile.png`

Replace only the source component's image fill and keep it 32 × 32 with
transparency. Select the component or its export and use **cells.garden — Dev
ready**. The approved PNG is queued, validated, committed to `dev`, built, and
verified at https://dev.cells.garden. Production remains unchanged until the
separate production promotion is confirmed.

For a local Inspector-only experiment, select
`.garden-canvas-viewport::before` and replace `mask-image` and
`-webkit-mask-image`. Reloading restores the deployed asset; Inspector changes
do not update Figma or Git.
