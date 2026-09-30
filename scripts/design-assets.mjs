#!/usr/bin/env node
// Read native image fills from the open master file. Publication stays explicit.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const manifest = JSON.parse(readFileSync(resolve(ROOT, 'design/figma-assets.json'), 'utf8'));
export const coverage = JSON.parse(readFileSync(resolve(ROOT, 'design/asset-map.json'), 'utf8'));
const ENDPOINT = 'http://127.0.0.1:3845/mcp';
const MAX_PNG = 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function validatePng(bytes, asset) {
    requireThat(bytes.length >= 45 && bytes.length <= MAX_PNG, 'PNG must be non-empty and no larger than 1 MB.');
    requireThat(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Not a PNG image.');
    let offset = 8;
    let imageData = 0;
    let ended = false;
    while (offset < bytes.length) {
        requireThat(offset + 12 <= bytes.length, 'Truncated PNG chunk.');
        const length = bytes.readUInt32BE(offset);
        const end = offset + 12 + length;
        requireThat(end <= bytes.length, 'Truncated PNG data.');
        const kind = bytes.toString('ascii', offset + 4, offset + 8);
        requireThat(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG checksum mismatch.');
        if (offset === 8) {
            requireThat(kind === 'IHDR' && length === 13, 'PNG has no valid header.');
            requireThat(bytes.readUInt32BE(16) === asset.width && bytes.readUInt32BE(20) === asset.height,
                `Expected native ${asset.width} × ${asset.height} pixels. No resizing is performed.`);
        } else requireThat(kind !== 'IHDR', 'PNG has multiple headers.');
        requireThat(kind !== 'acTL', 'Use a static PNG, not an animation.');
        if (kind === 'IDAT') imageData += length;
        if (kind === 'IEND') {
            requireThat(length === 0 && end === bytes.length, 'Unexpected data after PNG end.');
            ended = true;
        }
        offset = end;
    }
    requireThat(ended && imageData > 0, 'PNG has no image data or end marker.');
    return sha256(bytes);
}

export function assetKey(path) {
    return Object.entries(manifest.assets).find(([, asset]) => asset.path === path)?.[0]
        ?? path.replace(/^src\/assets\//, '').replace(/\.[^.]+$/, '').replaceAll('/', '-');
}

export function assetByName(name) {
    if (Object.hasOwn(manifest.assets, name)) return manifest.assets[name];
    const entry = coverage.assets.find(asset => assetKey(asset.path) === name);
    requireThat(entry, `Unknown asset: ${name}. Run npm run design:list.`);
    // Source-only links are intentionally not guessed EXPORTS instances.
    return { ...entry, exportNodeId: entry.sourceNodeId, exportName: entry.sourceName };
}

export function parseRpc(body, id) {
    const messages = body.trim().startsWith('{') ? [JSON.parse(body)] : body.split(/\r?\n\r?\n/)
        .map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean).map(data => JSON.parse(data));
    const message = messages.find(value => value.id === id);
    requireThat(message && !message.error, message?.error?.message || 'No matching response from Figma.');
    requireThat(!message.result?.isError, message.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Figma could not read this node.');
    return message.result;
}

async function boundedBody(response, limit) {
    requireThat(response.ok, `Figma returned HTTP ${response.status}. Open the master file in the desktop app and enable its MCP server.`);
    const parts = [];
    let length = 0;
    for await (const part of response.body || []) {
        length += part.length;
        requireThat(length <= limit, 'Figma response is too large.');
        parts.push(Buffer.from(part));
    }
    return Buffer.concat(parts);
}

export function createFigmaClient(fetcher = fetch) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    let nextId = 0;
    const rpc = async (method, params, notification = false) => {
        const id = notification ? undefined : ++nextId;
        const response = await fetcher(ENDPOINT, {
            method: 'POST', headers,
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: AbortSignal.timeout(45000), redirect: 'error',
        });
        const session = response.headers.get('mcp-session-id');
        if (session) headers['mcp-session-id'] = session;
        const bytes = await boundedBody(response, 8 * 1024 * 1024);
        return notification ? undefined : parseRpc(bytes.toString('utf8'), id);
    };
    return {
        async initialize() {
            await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cells-garden-design', version: '1.0.0' } });
            await rpc('notifications/initialized', {}, true);
        },
        call: (name, args) => rpc('tools/call', { name, arguments: args }),
        async close() {
            if (headers['mcp-session-id']) await fetcher(ENDPOINT, { method: 'DELETE', headers, signal: AbortSignal.timeout(3000), redirect: 'error' }).catch(() => {});
        },
    };
}

export function imageUrl(context) {
    // Only the generated component, never prose examples or executable code.
    const code = context.content?.find(item => item.type === 'text')?.text || '';
    const urls = [...new Set([...code.matchAll(/https?:\/\/[^\s"'<>`]+/g)].map(match => match[0]))];
    requireThat(urls.length === 1, 'Expected one original image fill. Composite/vector exports need a separate reviewed mapping.');
    const url = new URL(urls[0]);
    requireThat(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
        && url.port === '3845' && /^\/assets\/[a-f0-9]+\.png$/.test(url.pathname)
        && !url.username && !url.password && !url.search && !url.hash, 'Expected a PNG from the local Figma asset server.');
    return url.href;
}

export function validateExport(metadata, asset) {
    const xml = metadata.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
    const tag = xml.match(/<(?:frame|instance|symbol)\b[^>]*>/)?.[0] || '';
    for (const [key, value] of Object.entries({ id: asset.exportNodeId, name: asset.exportName ?? asset.path, width: asset.width, height: asset.height })) {
        requireThat(tag.includes(`${key}="${value}"`), `Export ${key} does not match the manifest. Open the correct master file; do not remap by guesswork.`);
    }
}

export function stageAsset(name, bytes, root = ROOT) {
    const asset = assetByName(name);
    const candidateSha256 = validatePng(bytes, asset);
    const current = readFileSync(resolve(root, asset.path));
    const report = {
        asset: name, path: asset.path, fileKey: manifest.fileKey, exportNodeId: asset.exportNodeId,
        width: asset.width, height: asset.height, stagedAt: new Date().toISOString(),
        baselineSha256: sha256(current), candidateSha256,
        identical: current.equals(bytes), blocked: !!asset.blockedSha256?.includes(candidateSha256),
    };
    report.blocked = report.blocked || !report.identical;
    const directory = resolve(root, '.design-staging', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'candidate.png'), bytes);
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
}

export async function pullAsset(name) {
    const asset = assetByName(name);
    requireThat(asset.exportNodeId, 'No unambiguous Figma source is mapped. Correct the Figma source first.');
    requireThat(!asset.format || asset.format === 'png', 'Animated assets are reference-only. Keep the original file and timing.');
    const client = createFigmaClient();
    try {
        await client.initialize();
        const args = { nodeId: asset.exportNodeId, clientLanguages: 'typescript,css', clientFrameworks: 'unknown' };
        validateExport(await client.call('get_metadata', args), asset);
        const context = await client.call('get_design_context', args);
        const response = await fetch(imageUrl(context), { signal: AbortSignal.timeout(20000), redirect: 'error' });
        return stageAsset(name, await boundedBody(response, MAX_PNG));
    } finally { await client.close(); }
}

export function stagedAsset(name, root = ROOT) {
    const asset = assetByName(name);
    const directory = resolve(root, '.design-staging', name);
    const report = JSON.parse(readFileSync(resolve(directory, 'report.json'), 'utf8'));
    const bytes = readFileSync(resolve(directory, 'candidate.png'));
    requireThat(report.asset === name && report.path === asset.path && report.fileKey === manifest.fileKey
        && report.exportNodeId === asset.exportNodeId, 'Staged mapping changed. Pull again.');
    requireThat(validatePng(bytes, asset) === report.candidateSha256, 'Staged PNG changed. Pull again.');
    requireThat(sha256(readFileSync(resolve(root, asset.path))) === report.baselineSha256,
        'Repository artwork changed since this pull. Preserve those changes and pull again.');
    return { asset, report, bytes };
}

export function applyAsset(name, root = ROOT) {
    const { asset, bytes } = stagedAsset(name, root);
    requireThat(!asset.blockedSha256?.includes(sha256(bytes)), 'This is the obsolete placeholder. Update the Figma source to the current artwork before applying.');
    requireThat(bytes.equals(readFileSync(resolve(root, asset.path))),
        'Visual preservation is enabled: Figma differs from the repository. Correct Figma; do not replace the shipped artwork.');
    // An identical candidate requires no file write, keeping timestamps intact.
    return asset.path;
}

export function previewServer(name, root = ROOT) {
    const { asset, report, bytes } = stagedAsset(name, root);
    const routes = new Map([
        ['/', ['text/html', readFileSync(new URL('./design-preview/index.html', import.meta.url))]],
        ['/preview.js', ['text/javascript', readFileSync(new URL('./design-preview/preview.js', import.meta.url))]],
        ['/preview.css', ['text/css', readFileSync(new URL('./design-preview/preview.css', import.meta.url))]],
        ['/candidate.png', ['image/png', bytes]],
        ['/current.png', ['image/png', readFileSync(resolve(root, asset.path))]],
        ['/report.json', ['application/json', JSON.stringify(report)]],
    ]);
    return createServer((request, response) => {
        const route = routes.get(request.url);
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        if (request.method !== 'GET' || !route) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', route[0]);
        response.end(route[1]);
    });
}

async function main() {
    const [command = 'list', name = 'void-tile', ...extra] = process.argv.slice(2);
    requireThat(extra.length === 0, 'Usage: design-assets.mjs list|pull|preview|apply [asset]');
    if (command === 'list') {
        for (const asset of coverage.assets) console.log(`${assetKey(asset.path)}: ${asset.width} × ${asset.height} [${asset.status}] → ${asset.path}`);
    } else if (command === 'pull') {
        console.log('Reading the open Figma master file. Repository artwork will not be changed.');
        const report = await pullAsset(name);
        console.log(report.blocked ? 'Staged different artwork. Applying is blocked to preserve the current appearance.' : 'Staged image is byte-identical to the repository.');
        console.log(`Preview: npm run design:preview -- ${name}`);
    } else if (command === 'preview') {
        const port = Number(process.env.DESIGN_PREVIEW_PORT || 5180);
        requireThat(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid preview port.');
        const server = previewServer(name);
        server.on('error', error => { console.error(error.message); process.exitCode = 1; });
        server.listen(port, '127.0.0.1', () => console.log(`Preview only: http://127.0.0.1:${server.address().port}/ (Ctrl+C to stop)`));
    } else if (command === 'apply') {
        console.log(`Confirmed identical artwork at ${applyAsset(name)}. No files changed.`);
    } else throw new Error('Use list, pull, preview, or apply.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
