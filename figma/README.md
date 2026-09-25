# Figma artwork

The only approved master is:

https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

## Designer workflow

Use the **cells.garden — Dev ready** plugin: connect the artwork once, select changed PNG sources, then approve a checkpoint. Validated approvals go to `dev.cells.garden`; production requires a separate reviewed promotion. See [PUBLISHING.md](PUBLISHING.md) for the ZIP, setup, status links and recovery.

The plugin and workflows are implemented, but their existence does not establish live Figma editing access, a completed migration or a successful deployment. Run the workflow's preflight and verify the first release. Never treat queued, pushed and live as the same state.

## Mapping and migration

`exports.json` may still record the previous copy until a complete mapping is read from an approved version of the confirmed master and verified. The normal sync rejects other file keys before credentials, network or writes. The checkpoint publisher never reads the previous copy: it reconstructs all links from the real master, validates native PNGs, then writes a verified mapping as part of the dev artwork transaction.

All current PNGs are covered by the linker. The animated GIF remains in Git and is not flattened. Existing source artwork and layout are preserved. See [MIGRATION.md](MIGRATION.md) for the lower-level inspection/adoption tooling; the designer plugin wraps that work in Connect artwork.

`FIGMA_TOKEN` belongs only in GitHub Actions secrets or ignored local environment configuration. It needs file-content and version-history read access to this master. Editor permission and token permission are separate. No file move or sharing change is performed by these tools.
