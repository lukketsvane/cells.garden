# Master design handoff

[Master file](https://www.figma.com/design/WJgKfsKcxUpuNkDvxI9gEx/cells.garden?node-id=27-1966)
→ source components on **ASSETS** → linked **EXPORTS** frames → local candidate
→ reviewed repository asset → `dev` → `main`.

The **current repository and build are the visual baseline**. Stale Figma artwork
must not replace it. Intentional changes require an exact candidate approval,
an actual-garden visual review, and a separately reviewed delivery.

## For the product team

Start the local review desk once with `npm run design:studio`, then open the
printed address. Routine artwork work stays in that screen; hashes and terminal
approval commands are not required.

1. Choose the artwork. **Open in Figma** takes you to its existing source.
2. Use **Get from Figma**, or choose its native 1× PNG if the connection is limited.
3. Select **Preview in garden**. Compare the current and proposed artwork in the
   actual desktop and mobile garden; changed pixels are shown separately.
4. Add a short review note and select **Approve artwork**.
5. Select **Submit to dev**. The desk runs the checks and opens a GitHub review
   request. Review and merge that request through the team's normal process.

Every draft starts in a private worktree from the published `dev` branch. Your
working checkout and existing gardens are not modified. The screen cannot
publish to `main`, merge requests, enable unfinished features or approve an
unseen/stale candidate. A read limit offers the PNG import route, not a stale
automatic fallback. GitHub authentication is needed only for submission; the
desk does not collect account passwords or tokens.

An identical candidate needs no submission. Unmapped artwork and components
that the current garden fixture cannot exercise remain unavailable for approval.
The two legacy logos and animated stars are not treated as ordinary PNG imports.

The command-line sections below are for maintainers, troubleshooting and
advanced branch-specific reviews, not the everyday product-team workflow.

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
3. Run `npm run design:review -- void-tile` and open the printed loopback URL.
   This builds isolated current/candidate copies of the actual application,
   renders a deterministic garden at desktop and mobile sizes, and records
   before/after screenshots. It does not write to the repository's artwork or
   `dist`, use your account, or contact the production backend. Native pixels
   and repeat seams remain visible beside the garden evidence. The page is
   read-only and cannot approve or publish anything.
4. If the candidate is identical, `npm run design:apply -- void-tile` is a no-op.
   For an intentional visual change, inspect the screenshots and copy the exact
   approval command shown in the preview, supplying your review rationale:

   ```sh
   npm run design:approve -- void-tile --sha256 <exact-candidate-sha256> --note "Describe the reviewed change"
   ```

   Approval binds the candidate, baseline, renderer fingerprint and screenshot
   hashes. A changed candidate, source, review image or renderer invalidates it.
   An asset not exercised by the garden fixture cannot be approved. Unreleased
   artwork is not silently enabled just to make its review pass.
5. Switch to a short artwork feature branch, then run
   `npm run design:apply -- void-tile`. Changed artwork is refused on `main` and
   `original`. Applying updates only the selected PNG, its approved index entry
   and a receipt under `design/changes/`; it does not commit, push or deploy.
   Inspect and commit those files together, separately from code changes.
6. Use the delivery commands below for a checked request into `dev`, then a
   separate request into `main`. Never merge unrelated development work along
   with an artwork change.

### When Figma reads are unavailable

Export the mapped component from Figma as a native **1× PNG** and import it:

```sh
npm run design:import -- void-tile "path/to/native-export.png"
npm run design:review -- void-tile
```

This is explicitly recorded as `manual-export`, not live-verified Figma data.
It uses the same dimension, checksum, review and approval checks. Failed live
pulls never silently substitute an old candidate. The obsolete white void
placeholder remains unconditionally blocked, including after approval.

### Reviewed delivery and promotion

Commit only the intended artwork, its index update and approval receipt. Pass
the full 40-character commit SHA; the default command only prints a plan:

```sh
npm run design:deliver -- --target dev --commit <full-artwork-commit-sha>
npm run design:deliver -- --target dev --commit <full-artwork-commit-sha> --prepare
npm run design:deliver -- --target dev --commit <full-artwork-commit-sha> --publish
```

`--prepare` fetches published branches, checks contributor conflicts and builds
a fresh before/after garden review in an isolated target worktree. It does not
apply or publish artwork. Inspect its images, then resume with its exact review
digest and a decision note:

```sh
npm run design:deliver -- --prepared <worktree> --publish --review-sha256 <review-digest> --note "Describe the reviewed change"
```

`--publish` runs the required checks, pushes a short delivery branch, and opens
a pull request. Direct publication without preparation is allowed only when the
target artwork and renderer still match the approved review. Neither command
merges a pull request or force-pushes a branch. The product-team screen submits
to `dev` only. A separate, explicit maintainer action can later propose promotion:

```sh
npm run design:deliver -- --target main --commit <full-artwork-commit-on-dev> --publish
```

Promotion requires the exact approved artwork and its receipt on `origin/dev`,
with successful push CI for its current head. It starts from current `main`
and carries only the reviewed artwork change. A changed target asset or renderer
requires a fresh target review; conflicting published artwork from Max stops
delivery for reconciliation. Unrelated files, renamed assets, rewritten
receipts and altered source mappings are rejected. This is an explicit review
workflow, not automatic deployment when a Figma status label changes.

Live pulls stage original image-fill bytes, not a screenshot or resampled
frame export. Manual imports retain the supplied export bytes exactly.
PNG dimensions, structure and chunk checksums are validated;
the preview browser checks decoding. Colours and transparency are retained.
No temporary asset URL, design session ID or credential is saved in the report.
The preview is a snapshot: restart it after pulling a different candidate.
`design:preview` reopens existing evidence without rebuilding; `design:review`
creates fresh evidence. Stop an existing preview with Ctrl+C before reopening,
or choose another loopback port with `DESIGN_PREVIEW_PORT`.

## Verification coverage

- Unit/contract tests cover malformed PNGs, exact mapping identity, source hashes,
  transport responses, manual provenance, quota errors and approval invalidation.
- Browser tests cover native pixels, repeat seams, desktop/mobile layout,
  read-only comparison routes and the product-team review screen. Local writes
  require a per-session token and a same-origin action; submission is dev-only.
- The garden round trip builds real before/after applications with an intentionally
  changed temporary PNG, checks visual evidence, approves and applies that exact
  change in a temporary branch, and verifies the real repository was untouched.
- Delivery tests exercise selected-commit validation and reject unrelated files,
  missing or mismatched approvals and unsafe promotion plans. CI runs these
  checks alongside the existing application tests.

CI uses isolated fixtures and simulated transport; it does not claim that the
external Figma service is available. The explicit native-export fallback keeps
the same review path usable during service quotas or connection problems.

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
successfully; the refreshed preview reports identical bytes. Desktop pulls must
wait for that quota to reset, or use the explicit native-export import path.
This does not change the verified source links or permit skipping review.
