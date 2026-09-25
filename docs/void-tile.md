# Void background tile

The site consumes `src/assets/void_tile.png`, a native 32 by 32 PNG, through
`.garden-canvas-viewport::before` in `src/core/void-tile.css`. Its alpha forms
the repeating pattern; CSS supplies the theme color. The image remains in the
repository and normal builds keep using it.

## Correct Figma destination

https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

The tile has **not yet been migrated to this master**. Its old source `253:410`
and export frame `253:411` belong to a different copy; they must not be reused
as links into the confirmed master without inspection.

The full and targeted Figma sync commands are deliberately blocked while
`figma/exports.json` still targets that copy. See [migration status](../figma/README.md).
Do not tell the designer that edits already publish from the confirmed master.

After the tile is created and verified there, it will have a linked native-size
export wrapper and an updated manifest entry. Replace its original image fill
with a 32 by 32 PNG and preserve transparency. The site's mask uses alpha,
not the image's RGB colors. Sync, commit and deployment are separate steps.

For a local Inspector test, select `.garden-canvas-viewport::before` and replace
`mask-image` and `-webkit-mask-image` with the test image URL. Reloading restores
the deployed file. This does not update Figma or Git.
