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
npm run design:review -- void-tile
```

Open the local URL printed by the preview command. Compare the candidate to
the current repository at native size and as a repeating background. Stop the
preview with Ctrl+C. To confirm that it matches:

```sh
npm run design:apply -- void-tile
```

Identical artwork is confirmed without changing files. An intentional new void
texture requires the actual-garden before/after review, explicit approval of its
exact SHA256 and an application on a feature branch. The preview prints the
approval command. Changes to the baseline, candidate, renderer or screenshots
invalidate approval. Delivery to `dev` and promotion to `main` are separate,
checked pull requests; nothing is automatically merged or deployed.

If Figma's read service is limited, export this mapped source as a native 1× PNG
and use `npm run design:import -- void-tile "path/to/export.png"`, followed by
the same review. A manual export is never labelled as live-verified data.

The existing Figma source was restored in place on 2026-09-30 with the current
repository PNG. Its original image-fill bytes were read back and verified with
SHA-256 `085da25188f1181c0653cf648b945ba84707c421f9fa054cd323f3aed5ccfff3`.
The linked export and all repeat-preview instances retain their source links.

The old white dash placeholder remains explicitly blocked from applying. If an
already-open preview still shows it, pull again and restart that preview: it is
a snapshot, not a live Figma view. Do not change the renderer back to a mask.

See [the design handoff](design-handoff.md) for mappings and the other exports.

## Local browser preview

Run `npm run dev` and open `/void-preview/`. Select your exported PNG to
check its native-size repetition and original colours against different backgrounds.
The preview validates the PNG, its 32 × 32 dimensions and visible pixels. It
uses only local browser memory: it does not upload, persist or publish a file.
The same preview is available at `https://dev.cells.garden/void-preview/`.

The unit suite checks dimensions and colour-preserving rendering, and
`npm run test:seo` checks the preview's valid/invalid-file paths. This browser
preview remains available alongside the repository design-review workflow.
