import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FIGMA_MASTER, assertFigmaMaster } from "./figma-source.mjs";

const contract = () => ({
  figma: { fileKey: FIGMA_MASTER.fileKey, pageId: FIGMA_MASTER.pageId, exportSectionId: "100:200" },
});

test("the source is the exact owner-confirmed master, not the old copy", () => {
  assert.equal(FIGMA_MASTER.fileKey, "Q9lb9XG2ftZZHswUg5zYkS");
  assert.equal(FIGMA_MASTER.pageId, "27:1966");
  assert.equal(new URL(FIGMA_MASTER.url).pathname, "/design/Q9lb9XG2ftZZHswUg5zYkS/cells.garden");
  assert.ok(Object.isFrozen(FIGMA_MASTER));
  assert.doesNotThrow(() => assertFigmaMaster(contract()));
});

test("rejects the old copy even when its page and export IDs look valid", () => {
  const manifest = contract();
  manifest.figma.fileKey = "WJgKfsKcxUpuNkDvxI9gEx";
  assert.throws(() => assertFigmaMaster(manifest), /sync is paused/);
});

test("rejects a missing source instead of guessing", () => {
  for (const manifest of [undefined, null, {}, { figma: {} }]) {
    assert.throws(() => assertFigmaMaster(manifest), /sync is paused/);
  }
});

test("rejects a different ASSETS page", () => {
  const manifest = contract();
  manifest.figma.pageId = "0:1";
  assert.throws(() => assertFigmaMaster(manifest), /confirmed ASSETS page/);
});

test("requires an explicit export section ID", () => {
  for (const value of [undefined, null, "", "pending", "100-200", 100]) {
    const manifest = contract();
    manifest.figma.exportSectionId = value;
    assert.throws(() => assertFigmaMaster(manifest), /verified EXPORTS section/);
  }
});

const syncScript = fileURLToPath(new URL("./sync-figma-assets.mjs", import.meta.url));
for (const selectedPath of ["", "src/assets/void_tile.png"]) {
  test(`wrong-master ${selectedPath ? "targeted" : "full"} sync makes no network request and preserves art`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-source-test-"));
    try {
      fs.mkdirSync(path.join(dir, "figma"));
      // A blocked sync must not even try to read local credentials.
      fs.mkdirSync(path.join(dir, ".env.local"));
      fs.mkdirSync(path.join(dir, "src/assets"), { recursive: true });
      const manifest = contract();
      manifest.figma.fileKey = "WJgKfsKcxUpuNkDvxI9gEx";
      manifest.items = [{ path: "src/assets/void_tile.png" }];
      fs.writeFileSync(path.join(dir, "figma/exports.json"), JSON.stringify(manifest));
      const image = path.join(dir, "src/assets/void_tile.png");
      fs.writeFileSync(image, "unchanged local art");
      const preload = path.join(dir, "no-network.mjs");
      fs.writeFileSync(preload, `import fs from 'node:fs'; globalThis.fetch = () => { fs.writeFileSync('network-accessed', 'yes'); throw new Error('Unexpected network request'); };`);
      const result = spawnSync(process.execPath, ["--import", preload, syncScript], {
        cwd: dir,
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, FIGMA_TOKEN: "", FIGMA_ASSET_PATH: selectedPath, FIGMA_FILE_KEY: FIGMA_MASTER.fileKey },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Figma sync is paused/);
      assert.doesNotMatch(result.stderr, /FIGMA_TOKEN is required/);
      assert.equal(fs.existsSync(path.join(dir, "network-accessed")), false);
      assert.equal(fs.readFileSync(image, "utf8"), "unchanged local art");
      assert.deepEqual(fs.readdirSync(path.join(dir, "src/assets")), ["void_tile.png"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
