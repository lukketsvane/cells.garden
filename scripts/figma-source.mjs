// The owner-confirmed master. Never infer a source file from matching node IDs.
export const FIGMA_MASTER = Object.freeze({
  fileKey: "Q9lb9XG2ftZZHswUg5zYkS",
  pageId: "27:1966",
  url: "https://www.figma.com/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden?node-id=27-1966",
});

/** Fail before token handling, network requests or asset writes. */
export function assertFigmaMaster(manifest) {
  if (manifest?.figma?.fileKey !== FIGMA_MASTER.fileKey) {
    throw new Error(
      `Figma sync is paused: figma/exports.json does not target the confirmed master ${FIGMA_MASTER.fileKey}. ` +
      `Open ${FIGMA_MASTER.url}. Rebuild and verify the export mapping there before resuming; ` +
      "do not just change the file key or reuse export IDs from another copy. Existing assets were not touched."
    );
  }
  if (manifest.figma.pageId !== FIGMA_MASTER.pageId) {
    throw new Error(`Figma sync requires the confirmed ASSETS page ${FIGMA_MASTER.pageId}. Existing assets were not touched.`);
  }
  if (typeof manifest.figma.exportSectionId !== "string" || !/^\d+:\d+$/.test(manifest.figma.exportSectionId)) {
    throw new Error("Figma sync requires a verified EXPORTS section ID from the confirmed master. Existing assets were not touched.");
  }
}
