import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ROOT, coverage, manifest, sha256 } from './design-assets.mjs';
import { createDesignBridge } from './design-bridge.mjs';
import { syncDesignExport } from './design-dev.mjs';

function fixture(t, sync = syncDesignExport) {
    const root = mkdtempSync(resolve(tmpdir(), 'garden-bridge-test-'));
    t.after(() => {
        assert(root.startsWith(`${resolve(tmpdir())}${sep}garden-bridge-test-`));
        rmSync(root, { recursive: true, force: true });
    });
    const asset = manifest.assets['roots-icon'];
    const baseline = readFileSync(resolve(ROOT, asset.path));
    const alternate = coverage.assets.find(item => item.format === 'png' && item.width === asset.width && item.height === asset.height && item.sha256 !== sha256(baseline));
    const candidate = readFileSync(resolve(ROOT, alternate.path));
    const target = resolve(root, asset.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, baseline);
    mkdirSync(resolve(root, 'design'));
    const indexPath = resolve(root, 'design/asset-map.json');
    writeFileSync(indexPath, JSON.stringify({ assets: [{ path: asset.path, sha256: sha256(baseline) }] }));
    const bridge = createDesignBridge({ root, sync });
    return { root, target, indexPath, baseline, candidate, bridge };
}

async function listening(t, bridge) {
    const server = createServer((req, res) => { void bridge.middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => server.close(done)));
    return ({ method = 'POST', path = '/__figma/assets', headers = {}, bytes = Buffer.alloc(0), chunked = false } = {}) => new Promise((done, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: {
            Host: 'localhost:5173', Origin: 'https://www.figma.com', 'Content-Type': 'image/png', 'X-Figma-Token': bridge.token,
            'X-Figma-File': manifest.fileKey, 'X-Figma-Asset': 'roots-icon', ...(chunked ? {} : { 'Content-Length': bytes.length }), ...headers,
        } }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (chunked) { req.write(bytes.subarray(0, 512)); req.end(bytes.subarray(512)); } else req.end(bytes);
    });
}

test('the local connection token survives restart, stays separate per checkout, and accepts an existing session', t => {
    const { root, bridge } = fixture(t);
    const tokenPath = resolve(bridge.pluginDirectory, 'token');
    assert.match(bridge.token, /^[a-f0-9]{64}$/);
    assert.equal(readFileSync(tokenPath, 'utf8').trim(), bridge.token);
    assert.equal(createDesignBridge({ root, sync: syncDesignExport }).token, bridge.token);
    assert.notEqual(fixture(t).bridge.token, bridge.token);
    const token = 'a'.repeat(64);
    assert.equal(createDesignBridge({ root, token, sync: syncDesignExport }).token, token);
    assert.equal(readFileSync(tokenPath, 'utf8').trim(), token);
    assert.equal(createDesignBridge({ root, sync: syncDesignExport }).token, token);
    for (const invalid of ['', 'a'.repeat(63), 'g'.repeat(64), null, 123]) {
        assert.throws(() => createDesignBridge({ root, token: invalid, sync: syncDesignExport }), /64 hexadecimal/);
        assert.equal(readFileSync(tokenPath, 'utf8').trim(), token);
    }
    writeFileSync(tokenPath, 'invalid');
    assert.throws(() => createDesignBridge({ root, sync: syncDesignExport }), /64 hexadecimal/);
});

test('authenticated native PNG delivery applies exact bytes and preserves independent changes', async t => {
    const { baseline, candidate, target, indexPath, bridge } = fixture(t);
    const send = await listening(t, bridge);
    const applied = await send({ bytes: candidate });
    assert.equal(applied.status, 200);
    assert.deepEqual(JSON.parse(applied.body).changes, [manifest.assets['roots-icon'].path]);
    assert.deepEqual(readFileSync(target), candidate);
    assert.equal(JSON.parse(readFileSync(indexPath)).assets[0].sha256, sha256(candidate));
    assert.equal(applied.headers['access-control-allow-origin'], 'https://www.figma.com');
    assert.equal((await send({ bytes: candidate, headers: { Origin: 'null' } })).status, 200);
    writeFileSync(target, baseline);
    const savedIndex = readFileSync(indexPath);
    assert.equal((await send({ bytes: candidate })).status, 400);
    assert.deepEqual(readFileSync(target), baseline);
    assert.deepEqual(readFileSync(indexPath), savedIndex);
    assert(!readdirSync(bridge.pluginDirectory).some(name => name.startsWith('incoming-')));
});

test('bridge rejects unauthorized, foreign, malformed and oversized uploads before source writes', async t => {
    const { baseline, candidate, target, indexPath, bridge } = fixture(t);
    const indexBytes = readFileSync(indexPath);
    const send = await listening(t, bridge);
    for (const headers of [{ 'X-Figma-Token': 'old-session' }, { 'X-Figma-File': 'other-file' }, { Origin: 'https://example.com' }, { Host: 'example.com:5173' }, { 'X-Figma-Asset': '../../outside' }, { 'Content-Type': 'text/plain' }]) {
        assert((await send({ bytes: candidate, headers })).status >= 400);
    }
    assert.equal((await send({ bytes: Buffer.from('not a PNG') })).status, 400);
    assert.equal((await send({ bytes: readFileSync(resolve(ROOT, manifest.assets.gnome.path)) })).status, 400);
    assert.equal((await send({ bytes: Buffer.alloc(1024 * 1024 + 1) })).status, 413);
    assert.equal((await send({ bytes: Buffer.alloc(1024 * 1024 + 1), chunked: true })).status, 413);
    assert.deepEqual(readFileSync(target), baseline);
    assert.deepEqual(readFileSync(indexPath), indexBytes);
    assert.equal((await send({ path: '/unrelated' })).status, 404);
    const preflight = await send({ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type,X-Figma-Token,X-Figma-File,X-Figma-Asset', 'X-Figma-Token': '' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers['access-control-allow-headers'], /X-Figma-Token/);
    assert.equal((await send({ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 400);
});

test('generated plugin exports selected and edited mapped sources serially without canvas changes', async t => {
    const { bridge, candidate } = fixture(t);
    const pluginManifest = JSON.parse(readFileSync(resolve(bridge.pluginDirectory, 'manifest.json')));
    assert.deepEqual(pluginManifest.networkAccess, { allowedDomains: ['none'], devAllowedDomains: ['http://localhost:5173'] });
    assert.equal(pluginManifest.enablePrivatePluginApi, true);
    assert.equal(bridge.assetCount, 289);
    const source = readFileSync(resolve(bridge.pluginDirectory, 'code.js'), 'utf8');
    const page = Object.freeze({ id: manifest.pageNodeId, type: 'PAGE' });
    const roots = { id: manifest.assets['roots-icon'].sourceNodeId, type: 'COMPONENT', parent: page };
    const child = Object.freeze({ id: 'test-child', type: 'RECTANGLE', parent: roots });
    roots.children = Object.freeze([child]); Object.freeze(roots);
    const gnome = Object.freeze({ id: manifest.assets.gnome.sourceNodeId, type: 'COMPONENT', parent: page });
    const instance = Object.freeze({ id: 'test-instance', type: 'INSTANCE', parent: page, getMainComponentAsync: async () => gnome });
    const nodes = new Map([page, roots, child, gnome, instance].map(node => [node.id, node]));
    const exported = [];
    for (const asset of [manifest.assets['roots-icon'], manifest.assets.gnome]) nodes.set(asset.exportNodeId, Object.freeze({
        id: asset.exportNodeId, type: 'INSTANCE', name: asset.path, width: asset.width, height: asset.height,
        getMainComponentAsync: async () => asset.path === manifest.assets.gnome.path ? gnome : roots,
        exportAsync: async settings => { assert.equal(settings.format, 'PNG'); assert.equal(settings.constraint.value, 1); exported.push(asset.path); return candidate; },
    }));
    const events = new Map(), timers = new Map(), notices = [], sent = [];
    let loaded = false, active = 0, maximum = 0, nextTimer = 0, disconnected = false;
    const figma = Object.freeze({
        fileKey: manifest.fileKey, currentPage: Object.freeze({ selection: Object.freeze([child]) }),
        getNodeByIdAsync: async id => nodes.get(id), loadAllPagesAsync: async () => { loaded = true; },
        on: (event, handler) => { assert(loaded); events.set(event, handler); }, notify: message => notices.push(message), closePlugin: message => assert.fail(message),
    });
    const context = {
        figma, setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
        fetch: async (url, options) => {
            assert.equal(url, 'http://localhost:5173/__figma/assets');
            assert.equal(options.headers['X-Figma-Token'], bridge.token);
            assert.equal(options.headers['X-Figma-File'], manifest.fileKey);
            active++; maximum = Math.max(maximum, active); sent.push(options.headers['X-Figma-Asset']);
            await new Promise(done => setImmediate(done)); active--;
            if (disconnected) throw new Error('Local server is restarting.');
            return { ok: true };
        },
    };
    await runInNewContext(source, context);
    await new Promise(done => setImmediate(done));
    for (const callback of [...timers.values()]) callback(); timers.clear();
    await new Promise(done => setImmediate(done));
    await new Promise(done => setImmediate(done));
    assert.deepEqual(sent, ['roots-icon']);
    assert.deepEqual(exported, [manifest.assets['roots-icon'].path]);
    events.get('documentchange')({ documentChanges: [{ type: 'PROPERTY_CHANGE', id: child.id }, { type: 'PROPERTY_CHANGE', id: instance.id }] });
    await new Promise(done => setImmediate(done));
    for (const callback of [...timers.values()]) callback(); timers.clear();
    for (let i = 0; i < 4; i++) await new Promise(done => setImmediate(done));
    assert.deepEqual(sent, ['roots-icon', 'roots-icon', 'gnome']);
    assert.equal(maximum, 1);
    assert.equal(notices.length, 1);
    events.get('documentchange')({ documentChanges: [{ type: 'PROPERTY_CHANGE', id: manifest.assets['roots-icon'].exportNodeId, properties: ['fills'] }] });
    await new Promise(done => setImmediate(done));
    for (const callback of [...timers.values()]) callback(); timers.clear();
    for (let i = 0; i < 3; i++) await new Promise(done => setImmediate(done));
    assert.equal(sent.at(-1), 'roots-icon');
    const beforeDeletion = sent.length;
    nodes.delete(child.id);
    events.get('documentchange')({ documentChanges: [{ type: 'DELETE', id: child.id }] });
    await new Promise(done => setImmediate(done));
    for (const callback of [...timers.values()]) callback(); timers.clear();
    for (let i = 0; i < 3; i++) await new Promise(done => setImmediate(done));
    assert.equal(sent.length, beforeDeletion + 1);
    assert.equal(sent.at(-1), 'roots-icon');
    const beforeMove = sent.length;
    events.get('documentchange')({ documentChanges: [{ type: 'PROPERTY_CHANGE', id: roots.id, properties: ['x', 'y'] }] });
    await new Promise(done => setImmediate(done));
    for (const callback of [...timers.values()]) callback(); timers.clear();
    await new Promise(done => setImmediate(done));
    assert.equal(sent.length, beforeMove);
    disconnected = true;
    events.get('documentchange')({ documentChanges: [{ type: 'PROPERTY_CHANGE', id: roots.id, properties: ['fills'] }] });
    await new Promise(done => setImmediate(done));
    for (const callback of [...timers.values()]) callback(); timers.clear();
    for (let i = 0; i < 3; i++) await new Promise(done => setImmediate(done));
    assert.equal(sent.at(-1), 'roots-icon');
    assert.equal(timers.size, 1);
    disconnected = false;
    const beforeRetry = sent.length;
    for (const callback of [...timers.values()]) callback(); timers.clear();
    for (let i = 0; i < 3; i++) await new Promise(done => setImmediate(done));
    assert.equal(sent.length, beforeRetry + 1);
    assert.equal(sent.at(-1), 'roots-icon');
    assert.equal(maximum, 1);
    events.get('close')();
    events.get('documentchange')({ documentChanges: [{ type: 'PROPERTY_CHANGE', id: child.id }] });
    await new Promise(done => setImmediate(done));
    assert.equal(timers.size, 0);
    let stopped;
    await runInNewContext(source, { ...context, figma: { ...figma, fileKey: 'another-file', closePlugin: message => { stopped = message; } } });
    assert.match(stopped, /master file/);
    stopped = undefined;
    await runInNewContext(source, { ...context, figma: { ...figma, fileKey: undefined, closePlugin: message => { stopped = message; } } });
    assert.match(stopped, /master file/);
});
