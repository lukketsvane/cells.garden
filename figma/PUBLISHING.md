# Designer publishing

Master: https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966

## Everyday workflow

1. Edit the image fill of a source component under **SOURCES** and keep its native dimensions.
2. Select the source, an export frame, or a folder.
3. Run the private **cells.garden — Dev ready** plugin and press **Dev ready**.
4. The plugin validates and queues only those PNG fills. GitHub polls approximately every five minutes, validates every byte again, commits to `dev`, builds, and verifies the exact revision at https://dev.cells.garden.
5. Review dev. Production remains unchanged until the separate production workflow is explicitly confirmed.

The private plugin talks to a narrow staging endpoint with a rotatable dev-publish key. The key is not committed, placed in Figma descriptions, or served by cells.garden. The endpoint accepts only this master, the 291 contracted PNG paths, and their exact dimensions. No `FIGMA_TOKEN` is required, and Figma MCP limits are not part of the normal designer workflow.

## Production

Run **Promote Figma artwork to production** with the exact revision currently verified on dev and tick the confirmation. It copies only hashes approved through the queue, rejects independent production artwork conflicts, runs the full build and browser test, pushes `main`, and verifies `cells.garden`. The designer never pushes directly to production.
