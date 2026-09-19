# Contributing

Thanks for helping the garden grow. The [README](README.md) covers what the project is and how it fits together.

## Setup

```sh
npm ci
npx playwright install chromium   # once, for the browser tests
npm run dev                       # http://localhost:5173
```

## Checks

Run these before opening a pull request:

```sh
npm run typecheck    # also typecheck:ext, typecheck:obsidian, typecheck:test
npm run lint         # the rules Obsidian's plugin review applies
npm run test:unit
npm run build        # web (dist/), extension (dist-ext/) and Obsidian plugin (obsidian-plugin/)
npm run test:web     # uses port 4173
npm run verify:figma-assets  # Figma export manifest ↔ src/assets paths + native PNG dimensions
```

Also run `npm run test:ext` when you touch `ext/`, and `npm run test:obsidian` when you touch `obsidian-plugin/`. Commit the rebuilt `obsidian-plugin/main.js` and `styles.css`.

## Where things live

- `src/core/`: the app itself, shared by every surface.
- `src/web/`: the web app and PWA shell.
- `ext/`: the Chrome extension, see `ext/README.md`.
- `obsidian-plugin/`: the Obsidian plugin source and its committed build.
- `supabase/`: migrations and backend notes.
- `scripts/`: icon generator, test runners and the Figma asset-contract verifier.
- `figma/exports.json`: generated handoff contract from the Figma `EXPORTS` section; exact repo paths and native PNG dimensions.

## Conventions

- English everywhere, short copy, no em-dashes.
- The garden view follows Max's original plugin (the `original` branch); keep its graphics, animation and layout as they are.
- No tool or assistant trailers in commit messages.
- Branch names are short and descriptive, e.g. `feat/extension`.

## Figma asset contract

The production Figma file is `Q9lb9XG2ftZZHswUg5zYkS`. Its visible `EXPORTS` section mirrors the PNG assets that may be written to `src/assets/**`.

- Pixel sprites stay at their native 1x dimensions in Figma. Runtime enlargement belongs to `PIXEL_SCALE` in code.
- Export through the exact-name frames in the Figma `EXPORTS` section, not through assembled `Garden/*` components or variant component names.
- `figma/exports.json` records each export destination and expected PNG width/height.
- `npm run verify:figma-assets` fails when a mapped file is missing, duplicated, non-PNG, has dimensions that drift from the Figma contract, or when any file under `src/assets/**` is not covered by the manifest.
- `stars_pattern.gif` and the two 3200x3200 brand PNGs remain repo-source-of-truth references and are intentionally not round-tripped from Figma.

When the Figma export surface changes, regenerate `figma/exports.json` from the live file before pushing asset changes.

### Pulling assets from Figma

Copy `.env.local.example` to `.env.local` and set `FIGMA_TOKEN` to a Figma personal access token with `file_content:read` access to the production file (or export the variable in your shell), then run:

```sh
npm run sync:figma-assets
```

The command reads the original image fill from each of the 277 atomic source components listed in `figma/exports.json`, checks its native PNG dimensions, writes only changed bytes to the exact manifest path under `src/assets/**`, and runs `verify:figma-assets` before returning success. It never renders, scales or resamples the pixel art. If Figma has stripped only ancillary PNG metadata but the IDAT pixel stream is unchanged, the existing repo file is preserved to avoid metadata-only binary churn. The manual **Sync Figma assets** GitHub Actions workflow runs the same path and commits changes to `main` when the repository secret `FIGMA_TOKEN` is configured. Repo-source-only GIF/logo files are never written by the sync.
