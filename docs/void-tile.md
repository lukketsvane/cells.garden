# Void background tile

The garden repeats `src/assets/void_tile.png` at **32 × 32 CSS pixels** through
`.garden-canvas-viewport` in `src/core/void-tile.css`. The original PNG supplies
both colour and transparency. Opaque artwork is valid. It is not an alpha mask.
Web, Chrome and Obsidian share this asset; no separate exports are needed.

## Design and review

Open the [master Void Tile component](https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx/cells.garden?node-id=253-410).
Replace its image fill with a native 32 × 32 PNG, without resizing, effects,
cropping or recolouring. Its linked export frame is `253:411`; the repeated
preview is `253:413`. Edit the source, not individual preview instances.

With this file open in the desktop app and its MCP server enabled:

```sh
npm run design:pull -- void-tile
npm run design:preview -- void-tile
```

Open the local URL printed by the preview command. Compare the candidate to
the current repository at native size and as a repeating background. Stop the
preview with Ctrl+C. After the artwork is approved:

```sh
npm run design:apply -- void-tile
```

Applying copies the original image bytes, with no resampling. It refuses to
overwrite artwork that changed after the pull. Nothing commits, pushes or
deploys automatically. Run the normal checks, review on `dev`, and promote the
reviewed asset to `main` without replacing unrelated changes.

The old white dash placeholder is explicitly blocked from applying: it predates
Max's current coloured tile. If it appears in the preview, update the existing
Figma source with the repository PNG and pull again. Do not change the renderer
back to a mask to accommodate it.

See [the design handoff](design-handoff.md) for mappings and the other exports.
