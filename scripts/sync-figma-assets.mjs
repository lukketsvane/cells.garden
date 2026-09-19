import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "figma", "exports.json"), "utf8"));
const token = process.env.FIGMA_TOKEN;

if (!token) {
  console.error("FIGMA_TOKEN is required. Create a Figma personal access token with read access to the production file.");
  process.exit(2);
}

const fileKey = manifest.figma?.fileKey;
if (!fileKey) throw new Error("figma.fileKey is missing from figma/exports.json");

function pngSize(buffer) {
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Figma returned non-PNG data");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function renderBatch(batch) {
  const ids = batch.map((item) => item.exportNodeId);
  if (ids.some((id) => !id)) throw new Error("Every manifest item must have exportNodeId");
  const url = new URL(`https://api.figma.com/v1/images/${fileKey}`);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("format", "png");
  url.searchParams.set("scale", "1");
  url.searchParams.set("use_absolute_bounds", "false");

  const response = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!response.ok) throw new Error(`Figma render request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  if (payload.err) throw new Error(`Figma render error: ${payload.err}`);
  return payload.images ?? {};
}

let written = 0;
for (const batch of chunks(manifest.items, 50)) {
  const images = await renderBatch(batch);
  for (const item of batch) {
    const imageUrl = images[item.exportNodeId];
    if (!imageUrl) throw new Error(`Figma returned no image for ${item.path} (${item.exportNodeId})`);
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to download rendered PNG for ${item.path}: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const size = pngSize(buffer);
    if (size.width !== item.width || size.height !== item.height) {
      throw new Error(`${item.path}: Figma rendered ${size.width}x${size.height}, manifest requires ${item.width}x${item.height}`);
    }

    const destination = path.join(root, item.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
    written += 1;
  }
}

execFileSync(process.execPath, [path.join(root, "scripts", "verify-figma-assets.mjs")], { stdio: "inherit" });
console.log(`Synced ${written} native 1x PNGs from Figma into src/assets/**.`);
