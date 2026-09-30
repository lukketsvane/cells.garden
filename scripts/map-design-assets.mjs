#!/usr/bin/env node
// Read-only reconciliation: the shipped files are authoritative.
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, manifest, createFigmaClient, sha256, imageUrl } from './design-assets.mjs';

export function repositoryAssets(root = ROOT) {
    const directory = resolve(root, 'src/assets');
    return readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
        const absolute = resolve(entry.parentPath, entry.name);
        const bytes = readFileSync(absolute);
        const path = relative(root, absolute).replaceAll('\\', '/');
        const format = extname(path).slice(1);
        const size = format === 'png' ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
            : format === 'gif' ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) } : {};
        return { path, format, ...size, sha256: sha256(bytes) };
    }).sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
}

export function metadataNodes(result) {
    const xml = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    const stack = [];
    const nodes = [];
    const decode = text => text.replace(/&(quot|apos|lt|gt|amp);/g, (_, entity) => ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' })[entity]);
    for (const match of xml.matchAll(/<(\/?)([a-z_-]+)\b([^>]*?)(\/?)>/g)) {
        if (match[1]) { stack.pop(); continue; }
        const attrs = Object.fromEntries([...match[3].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
        if (!attrs.id) continue;
        nodes.push({ nodeId: attrs.id, type: match[2], name: attrs.name, width: Number(attrs.width), height: Number(attrs.height), parentNodeId: stack.at(-1) ?? null });
        if (!match[4]) stack.push(attrs.id);
    }
    return nodes;
}

export function describedPaths(result) {
    const text = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    return [...new Set([...text.matchAll(/https:\/\/github\.com\/lukketsvane\/cells\.garden\/blob\/main\/(src\/assets\/[^\s)\]"<>]+\.(?:png|gif))/g)].map(m => decodeURIComponent(m[1])))];
}

export function classifyMapping(node, context, bytes, inventory) {
    const code = context.content?.find(c => c.type === 'text')?.text || '';
    const paths = describedPaths(context).filter(path => inventory.some(asset => asset.path === path));
    const digest = bytes ? sha256(bytes) : null;
    const identical = inventory.filter(asset => asset.sha256 === digest);
    const exactName = inventory.find(asset => asset.path === node.name);
    const asset = exactName || (paths.length === 1 ? inventory.find(asset => asset.path === paths[0]) : null)
        || (identical.length === 1 ? identical[0] : null);
    const sourceNodeId = /data-node-id="(\d+:\d+)"/.exec(code)?.[1] ?? null;
    const base = { exportNodeId: node.nodeId, exportName: node.name, sourceNodeId, width: node.width, height: node.height };
    if (!asset) return { ...base, status: 'unmapped', reason: 'No unambiguous repository path', candidatePaths: paths };
    const nativeSize = bytes?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
    const dimensionsMatch = node.width === asset.width && node.height === asset.height;
    const nativeMatch = nativeSize?.width === asset.width && nativeSize?.height === asset.height;
    return {
        ...base, path: asset.path, repositorySha256: asset.sha256, figmaSha256: digest,
        status: asset.format !== 'png' ? 'reference-only' : !dimensionsMatch ? 'geometry-mismatch'
            : !bytes ? 'unverified' : !nativeMatch ? 'geometry-mismatch'
                : digest === asset.sha256 ? 'verified' : 'bytes-differ',
        ...(nativeSize ? { nativeSize } : {}),
    };
}

export const isReadLimit = error => /rate limit|try again tomorrow|reauthentication|unauthorized/i.test(error.message);

const PLANTS = { plant_1: 'Bell', plant_2: 'Branch', plant_3: 'Vine', plant_4: 'Spray', plant_5: 'Arch', plant_6: 'Fork', plant_7: 'Starburst', plant_8: 'Cluster', plant_9: 'Plume' };
const ENVIRONMENT = { 'bg_image.png': 'Background', 'cloud.png': 'Clouds', 'mountains.png': 'Mountains', 'ground_tile.png': 'Ground Tile', 'stars_pattern.gif': 'Stars' };

export function findSource(asset, nodes) {
    const known = Object.values(manifest.assets).find(entry => entry.path === asset.path);
    if (known) return nodes.find(node => node.nodeId === known.sourceNodeId);
    const local = asset.path.replace(/^src\/assets\//, '');
    let parentName;
    let childName;
    const plant = /^pack\/(plant_\d+)\/(flowers|stem)\/(.+)\.png$/.exec(local);
    const ground = /^pack\/(minerals|roots|seeds)(\/seed_icons)?\/(.+)\.png$/.exec(local);
    const ant = /^ant_walk_(\d)\.png$/.exec(local);
    const pumpkin = /^pack\/pumpkin\/pumpkin_1_(off|on_\d)\.png$/.exec(local);
    if (plant) {
        parentName = `Source/Plants/${PLANTS[plant[1]]}`;
        childName = `Part=${plant[2] === 'stem' ? 'Stem' : 'Flowers'}, Variant=${plant[3]}`;
    } else if (ground) {
        parentName = `Source/Ground/${{ minerals: 'Minerals', roots: 'Roots', seeds: 'Seeds' }[ground[1]]}`;
        childName = ground[1] === 'seeds' ? `Kind=${ground[2] ? 'Icon' : 'Seed'}, Variant=${ground[3]}`
            : `${ground[1] === 'roots' ? 'Root' : 'Mineral'}=${ground[3]}`;
    } else if (ant) {
        parentName = 'Source/Creatures/Ant'; childName = `Frame=${ant[1]}`;
    } else if (pumpkin) {
        parentName = 'Source/Ground/Pumpkin';
        childName = `State=${pumpkin[1] === 'off' ? 'Off' : 'On ' + pumpkin[1].slice(3)}`;
    } else if (ENVIRONMENT[local]) {
        return nodes.find(node => node.name === `Source/Environment/${ENVIRONMENT[local]}` && node.parentNodeId === manifest.pageNodeId);
    }
    const parent = nodes.find(node => node.name === parentName && node.parentNodeId === manifest.pageNodeId);
    return parent && nodes.find(node => node.parentNodeId === parent.nodeId && node.name === childName);
}

export function buildCoverage(inventory, nodes, mappings, previousReports = []) {
    return inventory.map(asset => {
        const source = findSource(asset, nodes);
        const known = Object.values(manifest.assets).find(entry => entry.path === asset.path);
        const mapping = mappings.find(m => m.path === asset.path && m.figmaSha256)
            || mappings.find(m => m.path === asset.path);
        const previous = previousReports.find(r => r.path === asset.path && r.baselineSha256 === asset.sha256);
        const digest = mapping?.figmaSha256 ?? previous?.candidateSha256 ?? null;
        const same = digest === asset.sha256;
        const geometry = source && source.width === asset.width && source.height === asset.height;
        const status = !source ? (/CG_logo/.test(asset.path) ? 'ambiguous-source' : 'missing-source')
            : asset.format !== 'png' ? 'reference-only' : !geometry ? 'geometry-mismatch'
                : !digest ? 'unverified' : same ? 'verified' : 'bytes-differ';
        return {
            ...asset, status,
            sourceNodeId: source?.nodeId ?? null,
            sourceName: source?.name ?? null,
            ...(source ? { sourceWidth: source.width, sourceHeight: source.height } : {}),
            exportNodeId: known?.exportNodeId ?? mapping?.exportNodeId ?? null,
            exportName: known ? known.path : mapping?.exportName ?? null,
            figmaSha256: digest,
            evidence: digest ? 'image-bytes' : source ? 'named-source-only' : 'not-established',
        };
    });
}

export function offlineCoverage() {
    const directory = resolve(ROOT, '.design-staging');
    const report = JSON.parse(readFileSync(resolve(directory, 'mapping-audit.json'), 'utf8'));
    const nodes = JSON.parse(readFileSync(resolve(directory, 'asset-nodes.json'), 'utf8'));
    const previous = Object.keys(manifest.assets).flatMap(key => {
        const path = resolve(directory, key, 'report.json');
        return existsSync(path) ? [JSON.parse(readFileSync(path, 'utf8'))] : [];
    });
    const assets = buildCoverage(repositoryAssets(), nodes, report.mappings, previous);
    const coverage = { fileKey: manifest.fileKey, authority: 'repository', capturedAt: new Date().toISOString().slice(0, 10), assets };
    writeFileSync(resolve(directory, 'asset-map.candidate.json'), JSON.stringify(coverage, null, 2) + '\n');
    return coverage;
}

export async function auditMaster(limit = 20) {
    const inventory = repositoryAssets();
    const directory = resolve(ROOT, '.design-staging');
    const cacheDirectory = resolve(directory, 'contexts');
    mkdirSync(cacheDirectory, { recursive: true });
    const oldReport = existsSync(resolve(directory, 'mapping-audit.json'))
        ? JSON.parse(readFileSync(resolve(directory, 'mapping-audit.json'), 'utf8')) : null;
    if (oldReport?.blockedAt && new Date(oldReport.blockedAt).toDateString() === new Date().toDateString()) {
        throw new Error('Figma reached its read limit today. Use the saved inventory; retry after the limit resets.');
    }
    const client = createFigmaClient();
    try {
        await client.initialize();
        const nodes = metadataNodes(await client.call('get_metadata', { nodeId: manifest.pageNodeId }));
        writeFileSync(resolve(directory, 'asset-nodes.json'), JSON.stringify(nodes, null, 2) + '\n');
        const exports = nodes.filter(node => node.parentNodeId === manifest.exportSectionNodeId);
        if (!exports.length) throw new Error('The master EXPORTS section was not found. Open the correct file.');
        // Additional standalone sources are audited too, but remain reference-only
        // unless the image bytes identify a repository file unambiguously.
        const extraSources = nodes.filter(node => node.type === 'symbol' && /^Source\//.test(node.name)
            && node.parentNodeId === manifest.pageNodeId && !exports.some(e => e.name === node.name));
        const targets = [...exports, ...extraSources];
        const mappings = [...(oldReport?.mappings || [])];
        const failures = [];
        let blockedAt = null;
        let reads = 0;
        for (const node of targets) {
            if (reads >= limit) break;
            const cachePath = resolve(cacheDirectory, node.nodeId.replace(':', '-') + '.json');
            if (mappings.some(m => m.exportNodeId === node.nodeId && m.status === 'verified')) continue;
                try {
                    let context;
                    if (existsSync(cachePath)) context = JSON.parse(readFileSync(cachePath, 'utf8'));
                    else {
                        reads++;
                        const result = await client.call('get_design_context', { nodeId: node.nodeId, clientLanguages: 'typescript,css', clientFrameworks: 'unknown' });
                        // Cache the actual code and descriptions so later mapping work
                        // does not consume another read. Screenshots stay out of disk caches.
                        context = { content: result.content.filter(c => c.type === 'text') };
                        writeFileSync(cachePath, JSON.stringify(context) + '\n');
                    }
                    let bytes;
                    try {
                        const response = await fetch(imageUrl(context), { signal: AbortSignal.timeout(15000), redirect: 'error' });
                        if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
                        const parts = [];
                        let size = 0;
                        for await (const part of response.body) {
                            size += part.length;
                            if (size > 1024 * 1024) throw new Error('Image exceeds 1 MB');
                            parts.push(Buffer.from(part));
                        }
                        bytes = Buffer.concat(parts);
                    } catch (error) {
                        failures.push({ nodeId: node.nodeId, name: node.name, reason: error.message });
                    }
                    const mapping = classifyMapping(node, context, bytes, inventory);
                    const existing = mappings.findIndex(m => m.exportNodeId === node.nodeId);
                    if (existing >= 0) mappings[existing] = mapping;
                    else mappings.push(mapping);
                } catch (error) {
                    failures.push({ nodeId: node.nodeId, name: node.name, reason: error.message });
                    if (isReadLimit(error)) { blockedAt = new Date().toISOString(); break; }
                }
            console.log(`Read ${reads}/${limit} available requests; ${mappings.length} saved mappings`);
        }
        mappings.sort((a, b) => a.exportNodeId.localeCompare(b.exportNodeId, 'en', { numeric: true }));
        const report = { fileKey: manifest.fileKey, authority: 'repository', inventory, mappings, failures, blockedAt,
            missing: inventory.filter(asset => !mappings.some(m => m.path === asset.path)).map(asset => asset.path) };
        writeFileSync(resolve(directory, 'mapping-audit.json'), JSON.stringify(report, null, 2) + '\n');
        return report;
    } finally { await client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === '--offline') {
        const report = offlineCoverage();
        console.log(JSON.stringify({ files: report.assets.length, sources: report.assets.filter(a => a.sourceNodeId).length,
            statuses: report.assets.reduce((counts, a) => ({ ...counts, [a.status]: (counts[a.status] || 0) + 1 }), {}),
            missing: report.assets.filter(a => !a.sourceNodeId).map(a => a.path) }, null, 2));
    } else auditMaster().then(report => {
        console.log(JSON.stringify({ repositoryFiles: report.inventory.length, mappings: report.mappings.length,
            statuses: report.mappings.reduce((counts, m) => ({ ...counts, [m.status]: (counts[m.status] || 0) + 1 }), {}),
            missing: report.missing.length, failures: report.failures.length, blockedAt: report.blockedAt }, null, 2));
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
