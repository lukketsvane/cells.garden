import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertFigmaMaster } from './figma-source.mjs';

const root = process.cwd();
const checkOnly = process.env.FIGMA_CHECK_ONLY === '1';
if (process.env.FIGMA_MANIFEST_PATH && !checkOnly) {
  throw new Error('An alternate manifest is permitted only for read-only verification.');
}
const manifestPath = path.resolve(root, process.env.FIGMA_MANIFEST_PATH || 'figma/exports.json');
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assertFigmaMaster(manifest);
const seenPaths = new Set();
for (const item of manifest.items) {
  if (!/^src\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.png$/.test(item.path) || item.path.includes('..') || seenPaths.has(item.path)) throw new Error('Invalid or duplicate asset path; no credentials or artwork were touched.');
  seenPaths.add(item.path);
  if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 4096 || item.height > 4096) throw new Error('Invalid native image dimensions.');
  let part = root;
  for (const name of item.path.split('/')) {
    part = path.join(part, name);
    if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw new Error('Symlinked asset paths are not permitted.');
  }
}
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
}
const requestedPath = process.env.FIGMA_ASSET_PATH?.trim();
const items = requestedPath ? manifest.items.filter(item => item.path === requestedPath) : manifest.items;
if (requestedPath && items.length !== 1) throw new Error(`FIGMA_ASSET_PATH must match exactly one contracted export: ${requestedPath}`);
const token = process.env.FIGMA_TOKEN;
if (!token) throw new Error('FIGMA_TOKEN is required. Put a Figma token with file_content:read access in .env.local or the process environment.');
const fileKey = manifest.figma.fileKey;

function pngSize(b) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (b.length < 24 || !b.subarray(0,8).equals(signature)) throw new Error('Figma returned non-PNG image-fill data');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function imageContent(buffer) {
  const chunks = [], idat = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    if (type === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    // Keep palette, transparency and color profiles; those can change visible pixels.
    else if (!['iTXt','tEXt','zTXt','pHYs','tIME'].includes(type)) chunks.push(buffer.subarray(offset, offset + 8 + length));
    offset += 12 + length;
  }
  if (offset !== buffer.length || !idat.length) throw new Error('Malformed PNG image data');
  return Buffer.concat([...chunks, Buffer.concat(idat)]);
}
function imageRefs(node, out = new Set()) {
  if (Array.isArray(node?.fills)) for (const fill of node.fills) if (fill?.type === 'IMAGE' && fill.imageRef) out.add(fill.imageRef);
  if (Array.isArray(node?.children)) for (const child of node.children) imageRefs(child, out);
  return out;
}
function collectNodes(node, out = new Map()) {
  if (!node) return out;
  if (node.id) out.set(node.id, node);
  for (const child of node.children || []) collectNodes(child, out);
  return out;
}
function sameSize(node, width, height) {
  const b = node?.absoluteBoundingBox;
  return b && Math.abs(b.width - width) < 0.001 && Math.abs(b.height - height) < 0.001;
}
async function figmaJson(url) {
  const r = await fetch(url, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Figma API failed: HTTP ${r.status}`);
  return r.json();
}
function nodesUrl(ids, depth) {
  const url = new URL(`https://api.figma.com/v1/files/${fileKey}/nodes`);
  url.searchParams.set('ids', ids.join(','));
  if (depth) url.searchParams.set('depth', String(depth));
  return url;
}
const sectionId = manifest.figma.exportSectionId;
const pagePayload = await figmaJson(nodesUrl([manifest.figma.pageId], 1));
const page = pagePayload.nodes?.[manifest.figma.pageId]?.document;
if (!page || page.type !== 'CANVAS' || !page.children?.some(n => n.id === sectionId && n.type === 'SECTION')) throw new Error('EXPORTS must belong to the confirmed ASSETS page.');
const sectionPayload = await figmaJson(nodesUrl([sectionId]));
const section = sectionPayload.nodes?.[sectionId]?.document;
if (!section || section.type !== 'SECTION') throw new Error('The contracted EXPORTS section is missing.');
const exports = collectNodes(section);
const expectedFolders = [...new Set(manifest.items.map(i => path.posix.dirname(i.path)))].sort();
const actualFolders = (section.children || []).map(n => n.name).sort();
if (!requestedPath && JSON.stringify(expectedFolders) !== JSON.stringify(actualFolders)) throw new Error('Figma EXPORTS folders drifted; review the mapping.');
for (const item of items) {
  const n = exports.get(item.exportNodeId);
  if (!n || n.type !== 'FRAME' || n.name !== item.path || !sameSize(n, item.width, item.height)) throw new Error(`Export frame or native size drift: ${item.path}`);
  if (n.children?.length !== 1 || n.children[0].type !== 'INSTANCE' || n.children[0].componentId !== item.sourceComponentId) throw new Error(`Export must contain one linked instance of its source: ${item.path}`);
}
const refs = new Map();
for (let index = 0; index < items.length; index += 50) {
  const batch = items.slice(index, index + 50);
  const payload = await figmaJson(nodesUrl(batch.map(i => i.sourceComponentId)));
  for (const item of batch) {
    const n = payload.nodes?.[item.sourceComponentId]?.document;
    if (!n || n.type !== 'COMPONENT') throw new Error(`Missing source component: ${item.path}`);
    if (!sameSize(n, item.sourceWidth ?? item.width, item.sourceHeight ?? item.height)) throw new Error(`Source component geometry drift: ${item.path}`);
    const images = [...imageRefs(n)];
    if (images.length !== 1) throw new Error(`Expected exactly one original image fill: ${item.path}`);
    refs.set(item.path, images[0]);
  }
}
const fillPayload = await figmaJson(`https://api.figma.com/v1/files/${fileKey}/images`);
const urls = fillPayload.images ?? fillPayload.meta?.images ?? {};
const pendingWrites = [];
let unchanged = 0;
for (const item of items) {
  const imageUrl = urls[refs.get(item.path)];
  if (!imageUrl) throw new Error(`No original image URL for ${item.path}`);
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Image download failed for ${item.path}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const size = pngSize(buffer);
  if (size.width !== item.width || size.height !== item.height) throw new Error(`Original PNG dimensions differ: ${item.path}`);
  const content = imageContent(buffer);
  const destination = path.join(root, item.path);
  const original = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
  if (original?.equals(buffer)) { unchanged++; continue; }
  if (original) {
    try {
      const s = pngSize(original);
      if (s.width === size.width && s.height === size.height && imageContent(original).equals(content)) { unchanged++; continue; }
    } catch { /* The final repository verifier reports existing malformed assets. */ }
  }
  pendingWrites.push({destination, buffer, original});
}
// Validate every download before replacing any local image.
if (!manifestBytes.equals(fs.readFileSync(manifestPath))) throw new Error('Manifest changed during sync; no images written.');
for (const {destination, original} of pendingWrites) {
  const now = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
  if ((original === null) !== (now === null) || (original && !original.equals(now))) throw new Error('Artwork changed during sync; no images written.');
}
if (checkOnly) {
  console.log(`Figma read-only verification OK: ${items.length} native PNGs; ${pendingWrites.length} would change, ${unchanged} unchanged. No files written.`);
} else {
  try {
    for (const {destination, buffer} of pendingWrites) {
      fs.mkdirSync(path.dirname(destination), {recursive:true});
      fs.writeFileSync(destination, buffer);
    }
    execFileSync(process.execPath, [path.join(root,'scripts/verify-figma-assets.mjs')], {stdio:'inherit'});
  } catch (error) {
    for (const {destination, original} of pendingWrites) {
      if (original) fs.writeFileSync(destination, original);
      else if (fs.existsSync(destination)) fs.unlinkSync(destination);
    }
    throw error;
  }
  console.log(`Figma sync complete: ${pendingWrites.length} changed, ${unchanged} unchanged, ${items.length} native 1x PNGs checked.`);
}
