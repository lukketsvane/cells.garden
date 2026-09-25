# Void background tile

The repeating pattern outside the garden is `src/assets/void_tile.png`.
It is a native **32 × 32** white-on-transparent PNG, consumed as an alpha mask
by `.garden-canvas-viewport::before` in `src/core/void-tile.css`. The shared
`scene.ts` imports this stylesheet for the web app, extension and Obsidian.
The CSS supplies `--background-modifier-border`; the viewport retains
`--background-primary`. The pattern cannot intercept garden gestures.

## Figma source

- File: `WJgKfsKcxUpuNkDvxI9gEx`, ASSETS page `27:1966`.
- Component: **Source/Environment/Void Tile**, node `253:410`.
- Linked export frame: `253:411`, named `src/assets/void_tile.png` inside EXPORTS.
- Repeated 1x preview: `253:413`. Its instances update with the source component.
- Handoff contract: `figma/exports.json`.

Figma: https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx?node-id=253-410

Replace the component's image fill with a **32 × 32 PNG**. Keep the component,
export frame, IDs and dimensions intact. Use transparency for empty pixels;
only the alpha controls the website pattern, not the image's RGB colors.
The native-fill sync reads the original image fill, not a resized export.

## Sync this tile

Run **Sync Figma assets** in GitHub Actions with `asset_path` set to
`src/assets/void_tile.png`, or run locally:

```sh
FIGMA_ASSET_PATH=src/assets/void_tile.png npm run sync:figma-assets
```

The normal `FIGMA_TOKEN` with file-content read access is required. A targeted
sync validates and downloads only this contracted asset, then runs the whole
repository asset verifier. Leave the path empty for the original all-assets sync.

Figma edits are not deployed in real time: sync, commit and deploy remain
separate steps. The workflow commits changed assets directly to `main`.
