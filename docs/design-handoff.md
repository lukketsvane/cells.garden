# Master design handoff

[Master file](https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx/cells.garden?node-id=27-1966)
→ source components on **ASSETS** → linked **EXPORTS** frames → local candidate
→ reviewed repository asset → `dev` → `main`.

The **current repository and build are the visual source of truth**. Differences
are corrected in Figma, never by making the page look like a stale design.

`design/asset-map.json` indexes every one of the 292 source assets, with its
approved hash, native dimensions, source node and verification status.
`design/figma-assets.json` retains the original seven reviewed export mappings;
the complete index records the linked exports for all 289 mapped PNGs.
`design/render-map.json`
connects assembled designs, board elements, generated icons and renderer-owned
graphics to their existing implementation, without changing that implementation.
Its documentation URLs and the Figma components' documentation links point to
the relevant GitHub files. These are resource links and local mapping records,
not published Code Connect bindings.

## One-time setup

Keep the master file open in the Figma desktop app. Enable its local MCP server
in Dev Mode. The helper connects only to `http://127.0.0.1:3845/mcp` and downloads
images only from that server. No account token, secret or global editor setting
is added to the repository. The local server reads the active file, so keep the
correct master open. Each pull checks the configured node's exact ID, name and
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

The reconciled 2026-09-30 index links 290 assets to source nodes: 289 PNGs and
the reference-only animated stars. Verification distinguishes the source image
from Figma's rendered export:

| Status | Files | Meaning |
| --- | ---: | --- |
| Source verified | 289 | Canonical image hash matches the original repository bytes' SHA1; source geometry and linked native PNG export are configured |
| Reference only | 1 | Animated stars must remain the original GIF |
| Ambiguous source | 2 | Legacy logo PNGs cannot yet be assigned to a specific logo variant |

For each `source-verified` entry, `figmaImageSha1` records the confirmed source
image hash, with evidence `source-image-sha1-and-linked-export`. `figmaSha256`
is null: this reconciliation did not download and SHA256-check every rendered
Figma export. The repository's approved SHA256 remains unchanged. Source hash
verification does not claim that Figma's export encoder reproduces identical
PNG bytes.

Every mapped export was resolved through its actual main component, named with
the exact repository path, and configured at native dimensions with a 1× PNG
export. No link was inferred from canvas position. `npm run design:list` prints
each command key and status; the index records all source/export IDs and hashes.
Do not flatten assemblies or guess a logo variant.

## Figma organisation

The existing ASSETS page now has ten named top-level sections. Existing source
component IDs and instance relationships are retained; five Plume sources were
added. No artwork was deleted, and no runtime files or repository artwork changed.

| Section | Node |
| --- | --- |
| 01 / Environment & icons | `298:410` |
| 02 / Plants / native sprites | `298:414` |
| 03 / Ground & creatures / native sprites | `298:419` |
| 04 / Scene assemblies / renderer reference | `298:422` |
| 05 / Assembly slots / preserve padding | `298:426` |
| 06 / Board & UI / implementation reference | `162:279` |
| 07 / Void / linked repeat preview | `298:493` |
| EXPORTS | `186:410` |
| 90 / Reference only / legacy & unreleased | `298:484` |
| 99 / Sketch archive / not for export | `298:488` |

The 99 Assembly Slot wrappers are retained. All 99 were checked and contain
nested Sprite instances, not independent replacement artwork; their padding
and assembly roles must survive any later consolidation. Export and preview
instances are useful links to canonical sources, not duplicate source artwork.

Canonical source components and families have GitHub documentation links, as do
the renderer references. Figma's native **Ready for dev** status was set and
verified in the desktop app for sections 01, 02, 03, EXPORTS and 07 on 2026-09-30.
Scene assemblies, padding references, historical UI, unreleased work and sketches
remain reference-only rather than approved implementation targets. Marking an
artwork library ready does not enable unreleased features in the application.

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

The earlier metadata and context caches predate this reconciliation. They remain
historical evidence, not a current snapshot of the organised file. Refresh the
relevant live metadata and contexts before using a candidate to revise current
source IDs, names or verification status; do not promote an older cache over the
reconciled index.

Review the candidate before updating `design/asset-map.json`. The design tests
check that every source file remains present with its approved bytes. A future
intentional artwork change needs its own review and corresponding hash update;
do not refresh the index merely to hide a mismatch.

## Current reconciliation

The void source `253:410` now contains the current repository artwork, restored
in place; export `253:411` and repeat preview `253:413` remain linked. The known
obsolete PNG digest stays blocked as a regression safeguard. See
[void tile](void-tile.md).

The cloud source `29:3204` now uses the shipped 540 × 119 native geometry.
Plume family `296:415` contains five canonical sources `296:410`–`296:414`, linked
to exports `296:416`–`296:420` in flower_1, flower_2, Stem_1, Stem_2, Stem_3 order.
Other differing source fills were corrected in place to the original repository
image bytes.

The two legacy logo PNGs remain ambiguous against Figma's four logo variants.
The shipped `public/icon.svg` and generated application icons remain authoritative
and untouched. Stars remain the original animated GIF. The desktop pull helper
is read-only; routine pulls do not organise or modify the Figma document.

The final desktop MCP pull on 2026-09-30 reported a daily rate limit. The exact
void image was separately read back through the editing connection and staged
successfully; the refreshed preview reports identical bytes. Routine desktop
pulls must wait for that quota to reset. This does not change the verified source
links or permit bypassing the repository's artwork-preservation checks.
