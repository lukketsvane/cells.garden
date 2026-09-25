# Finish the master Figma connection

Master: https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

## Status and scope

This repository contains migration tooling, not a claim of a completed live
migration. Figma MCP last refused the master through the Starter limit. The
file move is unverified. The old copy remains blocked by `assertFigmaMaster`.
No synthetic test node IDs are used in the real export contract.

The plan includes all 291 current PNG files, not just the 278 old exports.
`stars_pattern.gif` remains a repository-authoritative animated source and is
never flattened into a PNG. Runtime code and all 292 artwork files are unchanged.

## Prepare

```sh
npm run test:figma-migration
npm run prepare:figma-master
```

This offline operation creates the ignored `dist-figma-migration/` directory:
`plan.json`, instructions and six ordered scripts for the current library.
It makes no Figma requests and does not change the active mapping. The scripts
contain public repository image data, not credentials. An existing output
directory is never overwritten; regenerate into a new directory after a
mapping or artwork change. Large logos use a compact exact byte encoding,
not resampling. Each script fits the tool's 50,000-character limit.

## Execute in the existing, authorized master

Restore normal editing/tool access to the exact master before executing.
Do not use another copy, another account, a hidden endpoint or a fabricated
file identity. This helper does not move files, alter sharing, buy anything
or change access limits. Verify file location and collaborator access separately.

Load the usual `figma-use` guidance and run the numbered scripts through
`use_figma` on the confirmed file. A missing or different `figma.fileKey`
stops execution. Each batch returns all affected node IDs. After a failure,
inspect actual state before retrying; duplicate names or ambiguous sources
stop the migration rather than silently producing another library.

Existing source artwork, component geometry and instances elsewhere stay
untouched. Sources are reused only if they are local ASSETS components with
one identifiable original PNG of the expected native dimensions. Ambiguous
fills, changed PNG sizes or detached components require review. Missing PNG
sources are added without replacing existing art. EXPORTS contains native-size
frames named by exact repository path, each with one linked instance; folders
use auto-layout. Native pixel dimensions and source component geometry are
recorded separately, so grass, clouds and gnome are not resized to fix a mismatch.

The last script only reads the completed mapping. Save its JSON return as
`report.json`. Inspect the actual EXPORTS layout and void tile visually before
adoption. Simulated tests do not replace this live visual check.

## Verify and adopt

Configure `FIGMA_TOKEN` with read access to this master in local `.env.local`
or the process environment. Never put it in a script, report, Figma or chat.

```sh
npm run adopt:figma-master -- /path/to/report.json
npm run verify:figma-assets
```

Adoption rejects stale snapshots, missing paths, duplicate nodes, invalid
sizes and the wrong master. It then checks the candidate through authenticated
read-only Figma API requests: EXPORTS belongs to ASSETS, all frames point to
their contracted source, source geometry matches and every original PNG has
its correct native size. No image is written during adoption. Only successful
live verification permits the candidate to replace `figma/exports.json`.
Concurrent repository edits abort adoption. Review and commit the mapping
separately before publishing image changes. A report cannot bypass permissions.

## Designer workflow after adoption

Open EXPORTS in Figma, find the exact PNG filename, select its instance and
choose Go to main component. Replace its image fill with a PNG of the same
native dimensions. The sync reads original image bytes, not vector overlays,
effects or resized exports. Preserve node IDs, export paths and native sizes.
The void tile uses transparency as a mask; the app supplies its theme color.

Run **Sync Figma assets** in GitHub Actions. It now defaults to **check_only**,
which reports changes without writing or committing artwork. Use `asset_path`
for one exact PNG, or leave it empty for the full mapping. Inspect the result,
then uncheck `check_only` to publish changed assets. All image downloads are
validated before the first replacement; a normal write/verification failure
restores originals. Publication remains one Git commit, not a real-time link.

## Tests and limitations

The regression suite covers source identity, native image sizes, preserving
existing component geometry, complete-library simulation, idempotent reruns,
byte-identical logo import, stale or invalid reports, read-only sync, failed
adoption, concurrent edits and a late remote failure without partial writes.
It uses a simulated Plugin API and mocked HTTP responses, not live Figma.

The animated GIF remains explicitly protected in Git. This is a PNG-asset
connection, not automatic implementation of every Figma screen, variable or effect.

Official API references:
- https://developers.figma.com/docs/plugins/api/figma/
- https://developers.figma.com/docs/plugins/api/Image/
