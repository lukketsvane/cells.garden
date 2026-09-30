# Master design handoff

[Master file](https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx/cells.garden?node-id=27-1966)
→ source components on **ASSETS** → linked **EXPORTS** frames → local candidate
→ reviewed repository asset → `dev` → `main`.

The **current repository and build are the visual source of truth**. Differences
are corrected in Figma, never by making the page look like a stale design.

`design/asset-map.json` indexes every one of the 292 source assets, with its
approved hash, native dimensions, source node and verification status.
`design/figma-assets.json` retains the original seven reviewed export mappings;
other named sources can be addressed through the same commands. `design/render-map.json`
connects assembled designs, board elements, generated icons and renderer-owned
graphics to their existing implementation, without changing that implementation.
These are local mapping records, not published Code Connect bindings.

## One-time setup

Keep the master file open in the Figma desktop app. Enable its local MCP server
in Dev Mode. The helper connects only to `http://127.0.0.1:3845/mcp` and downloads
images only from that server. No account token, secret or global editor setting
is added to the repository. The local server reads the active file, so keep the
correct master open. Each pull checks the export's exact node ID, path name and
dimensions before accepting a single native PNG image fill.

## Initial reviewed exports

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

## Complete source inventory

The 2026-09-30 index links 285 assets to named source nodes. This distinguishes
structural mapping from verified image bytes:

| Status | Files | Meaning |
| --- | ---: | --- |
| Verified | 10 | Exact PNG bytes and source dimensions match |
| Unverified | 265 | Named source mapped; image bytes not yet verified |
| Bytes differ | 8 | Different encoding or artwork; not automatically a visible difference |
| Geometry mismatch | 1 | Cloud source is 540 × 156; the shipped PNG is 540 × 119 |
| Reference only | 1 | Animated stars must remain the original GIF |
| Missing source | 5 | Plume sprites have no matching Figma source family |
| Ambiguous source | 2 | Legacy logo PNGs cannot yet be assigned to a specific logo variant |

Figma's daily read limit interrupted image verification. No unverified source
is described as byte-identical. The full list and hashes are in the index;
`npm run design:list` prints each command key and status. Existing components,
variants, instances, page structure and layer ordering are preserved. Do not
flatten assemblies, infer an export instance from its position, or guess a
logo variant. Source-only links are distinct from reviewed EXPORTS frames.

## Routine workflow

1. Edit the appropriate source image fill at native size. Keep its linked export
   frame named exactly like the repository path. Do not edit preview instances.
2. Run `npm run design:pull -- void-tile` (or another key from `design:list`).
3. Run `npm run design:preview -- void-tile` and open the printed loopback URL.
   The page shows current/candidate artwork and native repeats, without uploads
   or write actions. Candidates live in ignored `.design-staging/`, outside all
   web, extension and plugin builds.
4. Run `npm run design:apply -- void-tile` to confirm an identical candidate.
   **Visual preservation is enabled:** any different bytes are rejected. An
   identical candidate is a no-op, including its file timestamp. A changed
   baseline or modified candidate also stops the operation. Correct Figma to
   match the approved repository asset before trying again.
5. Fetch and compare Max's latest published changes, inspect the diff, then run
   typecheck, lint, `test:design`, the full build, and `test:web`. Use the normal
   additional extension/plugin checks as appropriate. Commit as the repository
   owner and promote only the reviewed changes.

The helper stages original image-fill bytes, not a screenshot or resampled
frame export. PNG dimensions, structure and chunk checksums are validated;
the preview browser checks decoding. Colours and transparency are retained.
No temporary asset URL, design session ID or credential is saved in the report.
The preview is a snapshot: restart it after pulling a different candidate.

## Resume verification safely

`npm run design:audit` reads at most 20 new source contexts, caches responses,
and stops on the first quota/authentication error. It refuses further reads
on a day already marked rate-limited. `npm run design:map` rebuilds an ignored
candidate index from saved evidence, without contacting Figma. Neither command
updates tracked artwork or the approved index automatically. Variant components
that expose multiple image fills still require targeted inspection; the helper
does not guess which image to use.

Review the candidate before updating `design/asset-map.json`. The design tests
check that every source file remains present with its approved bytes. A future
intentional artwork change needs its own review and corresponding hash update;
do not refresh the index merely to hide a mismatch.

## Current reconciliation

The void source inspected on 2026-09-30 still contained the obsolete white dash
and a stale alpha-mask description. The repository's newer coloured artwork
remains authoritative. The old PNG digest is blocked from applying until the
source is updated. See [void tile](void-tile.md).

The desktop MCP connection is read-only. Pulling does not organise or modify
the Figma document. The remote write connection still needs reauthentication.
The Plume sources, logo selection, cloud frame and stale image fills therefore
remain a Figma-side reconciliation queue, not permission to change production.
