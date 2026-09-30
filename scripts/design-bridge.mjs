import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, assetKey, coverage, manifest, validatePng } from './design-assets.mjs';

const ENDPOINT = '/__figma/assets';
const MAX_PNG = 1024 * 1024;

async function runFigmaBridge({ assets, fileKey, pageNodeId, token }) {
    if (figma.fileKey !== fileKey) throw new Error('Open the cells.garden master file to connect artwork.');
    const page = await figma.getNodeByIdAsync(pageNodeId);
    if (!page || page.type !== 'PAGE') throw new Error('The mapped ASSETS page is missing.');
    await figma.loadAllPagesAsync();
    const bySource = new Map(assets.map(asset => [asset.sourceNodeId, asset]));
    const byExport = new Map(assets.map(asset => [asset.exportNodeId, asset]));
    const dependencies = new Map();
    function remember(node, name) {
        if (!node) return;
        if (!dependencies.has(node.id)) dependencies.set(node.id, new Set());
        dependencies.get(node.id).add(name);
        if ('children' in node) for (const child of node.children) remember(child, name);
    }
    for (const asset of assets) {
        remember(await figma.getNodeByIdAsync(asset.sourceNodeId), asset.name);
        remember(await figma.getNodeByIdAsync(asset.exportNodeId), asset.name);
    }
    const pending = new Set();
    let timer, running = false, closed = false, collecting = Promise.resolve(), lastError = '';
    const fail = error => {
        const message = String(error.message || error);
        if (!closed && message !== lastError) figma.notify(`Live artwork stopped: ${message}`, { error: true });
        lastError = message;
    };
    async function related(node, seen = new Set()) {
        const original = node, names = new Set();
        while (node && !seen.has(node.id)) {
            seen.add(node.id);
            for (const name of dependencies.get(node.id) || []) names.add(name);
            const asset = bySource.get(node.id) || byExport.get(node.id);
            if (asset) names.add(asset.name);
            if (node.type === 'INSTANCE') for (const name of await related(await node.getMainComponentAsync(), seen)) names.add(name);
            node = node.parent;
        }
        for (const name of names) remember(original, name);
        return names;
    }
    async function flush() {
        if (running || closed) return;
        running = true;
        try {
            while (pending.size && !closed) {
                const name = pending.values().next().value;
                pending.delete(name);
                const asset = assets.find(value => value.name === name);
                try {
                    const frame = await figma.getNodeByIdAsync(asset.exportNodeId);
                    if (!frame || frame.name !== asset.path || frame.width !== asset.width || frame.height !== asset.height) throw new Error(`Native export mapping changed: ${asset.path}`);
                    const bytes = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
                    if (bytes.length > 1024 * 1024) throw new Error(`Export exceeds 1 MB: ${asset.path}`);
                    if (closed) return;
                    const response = await fetch('http://localhost:5173/__figma/assets', {
                        method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Figma-Token': token, 'X-Figma-Asset': name, 'X-Figma-File': fileKey }, body: bytes,
                    });
                    if (!response.ok) throw new Error((await response.json()).error || `Local server returned ${response.status}.`);
                    lastError = '';
                } catch (error) { fail(error); }
            }
        } finally { running = false; }
    }
    function collect(ids) {
        collecting = collecting.then(async () => {
            if (closed) return;
            for (const id of ids) {
                for (const name of dependencies.get(id) || []) pending.add(name);
                for (const name of await related(await figma.getNodeByIdAsync(id))) pending.add(name);
            }
            clearTimeout(timer);
            timer = setTimeout(() => { void flush(); }, 300);
        }).catch(fail);
    }
    figma.on('documentchange', event => collect(event.documentChanges.filter(change => ['CREATE', 'DELETE', 'PROPERTY_CHANGE'].includes(change.type)
        && !(change.type === 'PROPERTY_CHANGE' && (bySource.has(change.id) || byExport.has(change.id)) && change.properties?.every(property => property === 'x' || property === 'y'))).map(change => change.id)));
    figma.on('close', () => { closed = true; clearTimeout(timer); });
    figma.notify('Live artwork connected to the local garden. Keep this plugin running while editing.');
    collect(figma.currentPage.selection.map(node => node.id));
}

function readPng(request) {
    return new Promise((done, reject) => {
        const chunks = [];
        let size = 0, failed = false;
        request.on('data', chunk => {
            if (failed) return;
            size += chunk.length;
            if (size > MAX_PNG) {
                failed = true; chunks.length = 0;
                reject(Object.assign(new Error('PNG is larger than 1 MB.'), { status: 413 }));
            } else chunks.push(chunk);
        });
        request.on('end', () => { if (!failed) done(Buffer.concat(chunks)); });
        request.on('error', reject);
        request.on('aborted', () => reject(new Error('PNG upload was interrupted.')));
    });
}

export function createDesignBridge({ root = ROOT, token, sync } = {}) {
    if (typeof sync !== 'function') throw new Error('Provide the direct native-export sync helper.');
    const assets = [...new Map([
        ...coverage.assets.filter(asset => asset.format === 'png' && asset.sourceNodeId && asset.exportNodeId),
        ...Object.values(manifest.assets),
    ].map(asset => [asset.path, asset])).values()].map(asset => ({
        name: assetKey(asset.path), path: asset.path, sourceNodeId: asset.sourceNodeId, exportNodeId: asset.exportNodeId, width: asset.width, height: asset.height,
    }));
    const byName = new Map(assets.map(asset => [asset.name, asset]));
    const pluginDirectory = resolve(root, '.design-staging/figma-live');
    mkdirSync(pluginDirectory, { recursive: true });
    const tokenPath = resolve(pluginDirectory, 'token');
    if (token === undefined) token = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : randomBytes(32).toString('hex');
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw new Error('The local Figma connection token must be 64 hexadecimal characters.');
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    writeFileSync(resolve(pluginDirectory, 'manifest.json'), JSON.stringify({
        id: 'cells-garden-live-artwork', name: 'cells.garden live artwork', api: '1.0.0', main: 'code.js', editorType: ['figma'], documentAccess: 'dynamic-page', enablePrivatePluginApi: true,
        networkAccess: { allowedDomains: ['none'], devAllowedDomains: ['http://localhost:5173'] },
    }, null, 2) + '\n');
    writeFileSync(resolve(pluginDirectory, 'code.js'), `(${runFigmaBridge.toString()})(${JSON.stringify({ assets, fileKey: manifest.fileKey, pageNodeId: manifest.pageNodeId, token })}).catch(error => figma.closePlugin(String(error.message || error)));\n`);
    const expectedToken = Buffer.from(token);
    const middleware = async (request, response, next) => {
        if (request.url?.split('?')[0] !== ENDPOINT) { next(); return; }
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        const reply = (status, value) => { response.statusCode = status; response.end(JSON.stringify(value)); };
        try {
            const origin = request.headers.origin;
            if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
                || !['localhost:5173', '127.0.0.1:5173'].includes(request.headers.host)
                || (origin !== undefined && !['https://www.figma.com', 'https://figma.com', 'null'].includes(origin))) throw Object.assign(new Error('Use the local Figma artwork connection.'), { status: 403 });
            if (origin !== undefined) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
            if (request.method === 'OPTIONS') {
                const headers = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(header => header.trim()).filter(Boolean);
                if (request.headers['access-control-request-method'] !== 'POST'
                    || headers.some(header => !['content-type', 'x-figma-token', 'x-figma-asset', 'x-figma-file'].includes(header))) throw new Error('Unexpected Figma preflight request.');
                response.setHeader('Access-Control-Allow-Methods', 'POST');
                response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Figma-Token, X-Figma-Asset, X-Figma-File');
                response.statusCode = 204; response.end(); return;
            }
            if (request.method !== 'POST' || request.url !== ENDPOINT) throw Object.assign(new Error('Send a PNG to the artwork endpoint.'), { status: 405 });
            const supplied = Buffer.from(request.headers['x-figma-token'] || '');
            if (supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken)
                || request.headers['x-figma-file'] !== manifest.fileKey) throw Object.assign(new Error('Restart the live artwork plugin from this server session.'), { status: 403 });
            const name = request.headers['x-figma-asset'];
            const asset = byName.get(name);
            if (!asset) throw new Error('Choose a mapped PNG artwork component.');
            if ((request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'image/png') throw new Error('Send the native PNG bytes.');
            if (Number(request.headers['content-length']) > MAX_PNG) throw Object.assign(new Error('PNG is larger than 1 MB.'), { status: 413 });
            const bytes = await readPng(request);
            validatePng(bytes, asset);
            const path = resolve(pluginDirectory, `incoming-${randomUUID()}.png`);
            try {
                writeFileSync(path, bytes);
                const changes = await sync(path, { root, asset: name });
                reply(200, { changes });
            } finally { unlinkSync(path); }
        } catch (error) { request.resume(); reply(error.status || 400, { error: error.message }); }
    };
    return { middleware, pluginDirectory, token, assetCount: assets.length };
}
