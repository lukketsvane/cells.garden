# Void background tile

The garden repeats `src/assets/void_tile.png` at **32 × 32 CSS pixels** through
`.garden-canvas-viewport` in `src/core/void-tile.css`. The original PNG supplies
both colour and transparency. Opaque artwork is valid. It is not an alpha mask.
Web, Chrome and Obsidian share this asset; no separate exports are needed.

## Design and review

Open the [master Void Tile component](https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx/cells.garden?node-id=253-410).
Use the approved repository PNG as its image fill, without resizing, effects,
cropping or recolouring. Its linked export frame is `253:411`; the repeated
preview is `253:413`. Edit the source, not individual preview instances.

With this file open in the desktop app and its MCP server enabled:

```sh
npm run design:pull -- void-tile
npm run design:preview -- void-tile
```

Open the local URL printed by the preview command. Compare the candidate to
the current repository at native size and as a repeating background. Stop the
preview with Ctrl+C. To confirm that it matches:

```sh
npm run design:apply -- void-tile
```

Visual preservation is enabled: applying accepts only byte-identical artwork
and makes no file changes. A differing candidate is blocked, as is any artwork
that changed in the repository after the pull. Correct the Figma source instead
of replacing the shipped PNG. Nothing commits, pushes or deploys automatically.
Future intentional artwork changes require a separate explicit review.

The existing Figma source was restored in place on 2026-09-30 with the current
repository PNG. Its original image-fill bytes were read back and verified with
SHA-256 `085da25188f1181c0653cf648b945ba84707c421f9fa054cd323f3aed5ccfff3`.
The linked export and all repeat-preview instances retain their source links.

The old white dash placeholder remains explicitly blocked from applying. If an
already-open preview still shows it, pull again and restart that preview: it is
a snapshot, not a live Figma view. Do not change the renderer back to a mask.

See [the design handoff](design-handoff.md) for mappings and the other exports.
