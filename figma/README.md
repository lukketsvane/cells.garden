# Figma source and migration status

The owner-confirmed master is:

https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

Use this existing file. Do not create another copy or send the designer to the
previous `WJgKfsKcxUpuNkDvxI9gEx` file.

## Current state

`exports.json` still records the legacy copy's export mapping so the repository
can verify and build existing artwork without inventing new node IDs. It is
**not an active connection to the confirmed master**. Both full and targeted
sync reject any other source file before credentials, network or image writes.
`scripts/figma-source.mjs` owns this guard, covered by regression tests.

The last successful master inspection found ASSETS and existing source art,
but no EXPORTS section, Void Tile or CATEGORY ICONS. The next write was refused
by the file team's call limit. The file move is unverified and the live
migration is not complete. Existing runtime artwork remains unchanged.

## Prepared migration tooling

`npm run prepare:figma-master` generates bounded, ordered Plugin API scripts
for the whole current artwork library: 291 PNGs plus one protected animated
GIF. It includes the missing void tile, category icons, Plume parts, logos,
grass and gnome. Preparation is offline and does not alter the live mapping.

See [MIGRATION.md](MIGRATION.md) for execution in the authorized master,
read-only validation, adoption and the designer workflow. The wrong-copy guard
stays enabled until a complete live mapping is verified. Matching IDs across
copies are not evidence of matching art; never change only the file key.

Figma editor access and sync token access are separate. `FIGMA_TOKEN` must be
able to read the confirmed master. Never paste tokens into chat, component
descriptions, reports or committed files.
