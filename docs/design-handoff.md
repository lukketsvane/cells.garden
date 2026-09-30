# Master design handoff

[Master file](https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx/cells.garden?node-id=27-1966)
→ source components on **ASSETS** → linked **EXPORTS** frames → local candidate
→ reviewed repository asset → `dev` → `main`.

`design/figma-assets.json` records stable node IDs, repository paths and native
dimensions. `npm run design:list` lists the connected image-fill assets. This
is a reviewed asset pipeline, not automatic two-way document sync or component
code publishing. Figma changes cannot silently deploy to production.

## One-time setup

Keep the master file open in the Figma desktop app. Enable its local MCP server
in Dev Mode. The helper connects only to `http://127.0.0.1:3845/mcp` and downloads
images only from that server. No account token, secret or global editor setting
is added to the repository. The local server reads the active file, so keep the
correct master open. Each pull checks the export's exact node ID, path name and
dimensions before accepting a single native PNG image fill.

## Connected assets

| Asset | Source component | Export frame | Native size |
| --- | --- | --- | --- |
| Void tile | `253:410` | `253:411` | 32 × 32 |
| Grass | `263:410` | `263:411` | 540 × 10 |
| Gnome (unreleased) | `263:413` | `263:414` | 13 × 22 |
| Roots icon | `263:416` | `263:417` | 9 × 9 |
| Stem icon | `263:419` | `263:420` | 9 × 9 |
| Minerals icon | `263:422` | `263:423` | 9 × 9 |
| Flowers icon | `263:425` | `263:426` | 9 × 9 |

The native Git Source components are intentional: the older grass source is
552 × 10, and the older gnome is 20 × 35. They must not overwrite the differently
sized shipped sprites. Mapping gnome artwork does not enable Pets in the app.
The separate 9 × 9 icon frames at `251:411`–`251:414` are not the import sources.
Live pulls on 2026-09-30 verified that all six non-void mappings are byte-identical
to the current repository artwork.

The environment, plant assemblies, animation sheets and board components remain
in the master file, but are **not yet connected for automatic import**. Their
exports need individual mappings and visual review; do not flatten assemblies,
guess filenames, or bulk replace source assets. Existing source components,
variants, instances, page structure and layer ordering are preserved.

## Routine workflow

1. Edit the appropriate source image fill at native size. Keep its linked export
   frame named exactly like the repository path. Do not edit preview instances.
2. Run `npm run design:pull -- void-tile` (or another key from `design:list`).
3. Run `npm run design:preview -- void-tile` and open the printed loopback URL.
   The page shows current/candidate artwork and native repeats, without uploads
   or write actions. Candidates live in ignored `.design-staging/`, outside all
   web, extension and plugin builds.
4. After approval, run `npm run design:apply -- void-tile`. Only the mapped PNG is
   written. A changed baseline or modified candidate stops the application.
5. Fetch and compare Max's latest published changes, inspect the diff, then run
   typecheck, lint, `test:design`, the full build, and `test:web`. Use the normal
   additional extension/plugin checks as appropriate. Commit as the repository
   owner and promote only the reviewed changes.

The helper copies original image-fill bytes, not a screenshot or resampled
frame export. PNG dimensions, structure and chunk checksums are validated;
the preview browser checks decoding. Colours and transparency are retained.
No temporary asset URL, design session ID or credential is saved in the report.
The preview is a snapshot: restart it after pulling a different candidate.

## Current reconciliation

The void source inspected on 2026-09-30 still contained the obsolete white dash
and a stale alpha-mask description. The repository's newer coloured artwork
remains authoritative. The old PNG digest is blocked from applying until the
source is updated. See [void tile](void-tile.md).

The desktop MCP connection is read-only. Pulling does not organise or modify
the Figma document. Bulk document cleanup needs a working write connection or
reviewed edits in the desktop app; it is not performed by these commands.
