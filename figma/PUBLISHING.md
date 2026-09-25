# Designer publishing

Master: https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

## Everyday workflow

1. Edit the original PNG image fill in a connected source component. Keep its native dimensions.
2. Select the changed source, export frame or folder and press **Dev ready** in the cells.garden publisher plugin. The whole collection requires an explicit checkbox.
3. Use **Publishing status** to see validation and deployment, then **Open dev** to inspect the result at https://dev.cells.garden.

The button creates a named, immutable Figma version with the exact approved paths and image fingerprints. It is not Figma's built-in Ready for dev flag, which alone does not prove the artwork is unchanged since approval. Later drafts are excluded. Only original native PNG fills are published; vector overlays, effects, layout edits and new asset paths are not silently converted into artwork.

Checks are scheduled approximately every 15 minutes, plus validation/build/deployment time. A saved checkpoint is **queued**, a Git commit is **pushed**, and a matching public release receipt is **live**. These states are not interchangeable. The workflow fails rather than claiming an old HTTP 200 response is a successful release.

## One-time setup

Download https://cells.garden/figma-publisher.zip after the current web build deploys, or the `cells-garden-dev-ready` artifact from the **Publish Figma artwork** workflow. The ZIP is built from the exact repository inventory. It contains no credentials and makes no external network requests.

In the Figma desktop app, import `manifest.json` through Plugins > Development > Import plugin from manifest. This is a local/private plugin, not a Community publication. Figma assigns published plugin IDs; if the desktop app requires an ID, create a development plugin once and retain its assigned ID. Do not reuse another plugin's ID.

Open the existing master with editing access and run **Connect artwork** once. This executes the prepared linker for all current PNGs, reuses existing sources and creates missing native-size exports without overwriting the designer's artwork. The animated GIF stays repository-authoritative. Neither this plugin nor the publishing workflow moves the Figma file or changes sharing permissions.

Repository administrators set `FIGMA_TOKEN` in GitHub Actions secrets, with **file_content:read** and **file_versions:read** access to the confirmed master. Never put it in Figma, plugin code or chat. Run **Publish Figma artwork > preflight** to inspect actual setup. Token access and editor access are separate. A missing secret, insufficient permission, rate limit or missing EXPORTS section is reported as a blocker, not fabricated readiness.

The `dev` branch must exist and Vercel must bind it to `dev.cells.garden`; `main` must bind to `cells.garden`. The existing Vercel Git integration receives the commits. The publisher runs its own checks because a push using GITHUB_TOKEN does not automatically trigger other GitHub Actions workflows. It then verifies the exact release ID from `/art-release.json` on the target hostname. If that check fails, fix the Vercel integration/domain binding before promotion. A successful Git push alone is not proof of deployment.

## Production approval

After reviewing dev, run **Promote approved artwork to production** on `main`. Provide the exact 40-character dev commit SHA and check the explicit confirmation. The workflow verifies that commit belongs to dev and that its release is currently served on dev.cells.garden. It promotes cumulative approved artwork and its verified mapping, not unrelated development code. Independent production artwork edits cause a conflict instead of being overwritten. It validates/builds before pushing and verifies the production release receipt afterward.

## Safety and recovery

The full mapping is reconstructed from the actual pinned master version. All export links, native PNG dimensions, CRC checksums and compressed streams are validated before a transaction is written. Source geometry is recorded separately, so a scaled gnome, grass or cloud component is not resized. Only selected assets change; other drafts and the animated GIF remain untouched. The legacy source-copy guard stays intact.

Failures leave artwork unpublished. If Figma saved a checkpoint before the newest edits were included, the fingerprint check rejects it. Rename that rejected checkpoint in Figma's version history so it no longer has the exact publishing label, wait for saving, and press Dev ready again. An unavailable historical original image is never replaced by a newer draft. Rate-limit responses persist their Retry-After delay across scheduled runs.

The first live connection and first successful deployment still require verification in the authorized Figma file; automated tests use simulated Figma data and do not establish that editor access exists. New paths or native dimensions require a reviewed contract update and a fresh plugin build.

## Implementation and checks

`npm run test:figma-publishing` covers master rejection, mapping, approval scope, immutable version selection, PNG integrity, no-write checks, atomic failure, cumulative releases, conflicting production changes, queued-vs-live status and the actual plugin message flow. `npm run build:figma-publisher` builds the ZIP without credentials. Every normal web build also serves the ZIP for the designer.

Official references:
- https://developers.figma.com/docs/plugins/api/properties/figma-saveversionhistoryasync/
- https://developers.figma.com/docs/plugins/api/DevStatus/
- https://developers.figma.com/docs/rest-api/version-history-endpoints/
- https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow
