import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();

function loadEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnvLocal();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "figma", "exports.json"), "utf8"));
const token = process.env.FIGMA_TOKEN;

if (!token) {
  console.error("FIGMA_TOKEN is required. Put a Figma personal access token with file_content:read access in .env.local or the process environment.");
  process.exit(2);
}

const fileKey = manifest.figma?.fileKey;
if (!fileKey) throw new Error("figma.fileKey is missing from figma/exports.json");

function pngSize(buffer) {
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Figma returned non-PNG image-fill data");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function pngIdat(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return Buffer.concat(chunks);
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function imageRefs(node, out = new Set()) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill?.type === "IMAGE" && fill.imageRef) out.add(fill.imageRef);
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) imageRefs(child, out);
  }
  return out;
}

async function figmaJson(url) {
  const response = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!response.ok) throw new Error(`Figma API failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const sourceRefs = new Map();

for (const batch of chunks(manifest.items, 50)) {
  const ids = batch.map((item) => item.sourceComponentId);
  if (ids.some((id) => !id)) throw new Error("Every manifest item must have sourceComponentId");

  const url = new URL(`https://api.figma.com/v1/files/${fileKey}/nodes`);
  url.searchParams.set("ids", ids.join(","));
  const payload = await figmaJson(url);

  for (const item of batch) {
    const document = payload.nodes?.[item.sourceComponentId]?.document;
    if (!document) throw new Error(`Figma returned no source component for ${item.path} (${item.sourceComponentId})`);
    const refs = [...imageRefs(document)];
    if (refs.length !== 1) {
      throw new Error(`${item.path}: expected exactly one image fill in source component, found ${refs.length}`);
    }
    sourceRefs.set(item.path, refs[0]);
  }
}

const fillsPayload = await figmaJson(`https://api.figma.com/v1/files/${fileKey}/images`);
const fillUrls = fillsPayload.images ?? fillsPayload.meta?.images ?? {};

let changed = 0;
let unchanged = 0;

for (const item of manifest.items) {
  const imageRef = sourceRefs.get(item.path);
  const imageUrl = fillUrls[imageRef];
  if (!imageUrl) throw new Error(`Figma returned no image-fill URL for ${item.path} (${imageRef})`);

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to download original Figma image fill for ${item.path}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const size = pngSize(buffer);

  if (size.width !== item.width || size.height !== item.height) {
    throw new Error(`${item.path}: Figma image fill is ${size.width}x${size.height}, manifest requires ${item.width}x${item.height}`);
  }

  const destination = path.join(root, item.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(destination);
    if (existing.equals(buffer)) {
      unchanged += 1;
      continue;
    }

    // Figma may strip ancillary Photoshop/XMP/ICC chunks from an imported PNG
    // while preserving the exact compressed pixel stream. Keep the repo file in
    // that case so a no-op Figma sync never creates metadata-only binary churn.
    try {
      const existingSize = pngSize(existing);
      if (
        existingSize.width === size.width &&
        existingSize.height === size.height &&
        pngIdat(existing).equals(pngIdat(buffer))
      ) {
        unchanged += 1;
        continue;
      }
    } catch {
      // The verifier below will report malformed existing assets if necessary.
    }
  }

  fs.writeFileSync(destination, buffer);
  changed += 1;
}

execFileSync(process.execPath, [path.join(root, "scripts", "verify-figma-assets.mjs")], { stdio: "inherit" });
console.log(`Figma sync complete: ${changed} changed, ${unchanged} already byte-identical, ${manifest.items.length} native 1x PNGs checked.`);
