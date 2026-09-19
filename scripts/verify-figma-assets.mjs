import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "figma", "exports.json"), "utf8"));

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b[0] !== 0x89 || b.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`Not a PNG: ${file}`);
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const errors = [];
const seen = new Set();

if (manifest.schemaVersion !== 1) errors.push("Unsupported figma/exports.json schemaVersion");
if (manifest.policy?.format !== "PNG" || manifest.policy?.scale !== 1 || manifest.policy?.pixelArt !== "native-1x") {
  errors.push("Figma export policy must remain PNG / 1x / native-1x");
}
if (manifest.count !== manifest.items.length) {
  errors.push(`Manifest count ${manifest.count} does not match items.length ${manifest.items.length}`);
}

for (const item of manifest.items) {
  if (seen.has(item.path)) errors.push(`Duplicate export path: ${item.path}`);
  seen.add(item.path);
  const file = path.join(root, item.path);
  if (!fs.existsSync(file)) {
    errors.push(`Missing asset: ${item.path}`);
    continue;
  }
  try {
    const size = pngSize(file);
    if (size.width !== item.width || size.height !== item.height) {
      errors.push(`${item.path}: repo is ${size.width}x${size.height}, Figma contract is ${item.width}x${item.height}`);
    }
  } catch (error) {
    errors.push(String(error instanceof Error ? error.message : error));
  }
}

for (const ref of manifest.references ?? []) {
  if (!fs.existsSync(path.join(root, ref.path))) errors.push(`Missing reference source: ${ref.path}`);
}

if (errors.length) {
  console.error("Figma asset contract failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Figma asset contract OK: ${manifest.items.length} PNG exports + ${manifest.references?.length ?? 0} repo-source references.`);
