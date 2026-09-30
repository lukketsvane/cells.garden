import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import { ROOT, manifest, assetByName, validatePng, validateExport, imageUrl, parseRpc, createFigmaClient, stageAsset, applyAsset, previewServer, sha256 } from './design-assets.mjs';

const tile = readFileSync(resolve(ROOT, manifest.assets['void-tile'].path));
function fixture(t) {
    const root = mkdtempSync(resolve(tmpdir(), 'garden-design-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = resolve(root, manifest.assets['void-tile'].path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, tile);
    return { root, path };
}
const context = text => ({ content: [{ type: 'text', text }] });

test('every mapped asset exists with its exact native PNG dimensions', () => {
    for (const asset of Object.values(manifest.assets)) {
        assert.match(asset.path, /^src\/assets\/[\w/.-]+\.png$/);
        assert(!asset.path.includes('..'));
        assert.match(asset.sourceNodeId, /^\d+:\d+$/);
        assert.match(asset.exportNodeId, /^\d+:\d+$/);
        assert.match(validatePng(readFileSync(resolve(ROOT, asset.path)), asset), /^[a-f0-9]{64}$/);
    }
});

test('invalid, damaged, truncated, resized and oversized PNGs are rejected', () => {
    const asset = assetByName('void-tile');
    assert.throws(() => validatePng(Buffer.from('not png'), asset));
    const damaged = Buffer.from(tile);
    damaged[35] ^= 1;
    assert.throws(() => validatePng(damaged, asset), /checksum/);
    assert.throws(() => validatePng(tile.subarray(0, tile.length - 5), asset), /Truncated/);
    assert.throws(() => validatePng(tile, { width: 64, height: 32 }), /native/);
    assert.throws(() => validatePng(Buffer.alloc(1024 * 1024 + 1), asset), /1 MB/);
    assert.throws(() => assetByName('../void-tile'), /Unknown/);
    assert.throws(() => assetByName('toString'), /Unknown/);
});

test('only one local native image URL is accepted, not instruction examples', () => {
    const url = 'http://localhost:3845/assets/abc123.png';
    const result = context(`const image = "${url}";`);
    result.content.push({ type: 'text', text: 'Example: http://localhost:3845/assets/ffff.png' });
    assert.equal(imageUrl(result), url);
    for (const invalid of ['https://example.com/a.png', 'http://localhost:1234/assets/a.png', 'http://localhost:3845/assets/a.svg', 'http://user@localhost:3845/assets/a.png', url + '?token=a']) {
        assert.throws(() => imageUrl(context(`const image = "${invalid}";`)));
    }
    assert.throws(() => imageUrl(context(`"${url}" "http://localhost:3845/assets/ffff.png"`)), /one original/);
});

test('export identity and geometry must match exactly', () => {
    const xml = '<frame id="253:411" name="src/assets/void_tile.png" width="32" height="32" />';
    validateExport(context(xml), assetByName('void-tile'));
    for (const changed of [xml.replace('253:411', '263:411'), xml.replace('void_tile', 'old_tile'), xml.replace('width="32"', 'width="64"')]) {
        assert.throws(() => validateExport(context(changed), assetByName('void-tile')), /does not match/);
    }
});

test('JSON and SSE responses, notifications and tool errors are handled', () => {
    const message = { jsonrpc: '2.0', id: 2, result: { ok: true } };
    assert.deepEqual(parseRpc(JSON.stringify(message), 2), { ok: true });
    assert.deepEqual(parseRpc(`event: message\r\ndata: ${JSON.stringify({ method: 'notice' })}\r\n\r\ndata: ${JSON.stringify(message)}\r\n\r\n`, 2), { ok: true });
    assert.throws(() => parseRpc(JSON.stringify(message), 1), /matching/);
    assert.throws(() => parseRpc(JSON.stringify({ id: 2, error: { message: 'Unavailable' } }), 2), /Unavailable/);
    assert.throws(() => parseRpc(JSON.stringify({ id: 2, result: { isError: true, content: [{ type: 'text', text: 'Missing node' }] } }), 2), /Missing node/);
});

test('MCP initialization retains the session without logging or persisting it', async () => {
    const calls = [];
    const client = createFigmaClient(async (url, options) => {
        assert.equal(url, 'http://127.0.0.1:3845/mcp');
        assert.equal(options.redirect, 'error');
        if (calls.length) assert.equal(options.headers['mcp-session-id'], 'test-session');
        if (options.method === 'DELETE') return new Response(null, { status: 202 });
        const request = JSON.parse(options.body);
        calls.push(request);
        if (!request.id) return new Response(null, { status: 202 });
        return new Response(JSON.stringify({ id: request.id, result: { ok: true } }), { headers: { 'mcp-session-id': 'test-session' } });
    });
    await client.initialize();
    assert.deepEqual(await client.call('get_metadata', { nodeId: '253:411' }), { ok: true });
    await client.close();
    assert.deepEqual(calls.map(c => c.method), ['initialize', 'notifications/initialized', 'tools/call']);
});

test('staging is non-mutating and applying preserves every PNG byte', t => {
    const { root, path } = fixture(t);
    const report = stageAsset('void-tile', tile, root);
    assert.equal(report.identical, true);
    assert.equal(report.candidateSha256, sha256(tile));
    assert.deepEqual(readFileSync(path), tile);
    assert.equal(applyAsset('void-tile', root), manifest.assets['void-tile'].path);
    assert.deepEqual(readFileSync(path), tile);
});

test('changed repository artwork and changed candidates cannot be overwritten', t => {
    const { root, path } = fixture(t);
    stageAsset('void-tile', tile, root);
    writeFileSync(path, Buffer.from('contributor changed this file'));
    assert.throws(() => applyAsset('void-tile', root), /Repository artwork changed/);
    assert.equal(readFileSync(path, 'utf8'), 'contributor changed this file');
    writeFileSync(path, tile);
    writeFileSync(resolve(root, '.design-staging/void-tile/candidate.png'), Buffer.from('changed candidate'));
    assert.throws(() => applyAsset('void-tile', root), /PNG/);
});

test('blocked artwork cannot be applied even if the report is tampered with', t => {
    const { root } = fixture(t);
    const asset = assetByName('void-tile');
    const saved = asset.blockedSha256;
    asset.blockedSha256 = [...saved, sha256(tile)];
    t.after(() => { asset.blockedSha256 = saved; });
    stageAsset('void-tile', tile, root);
    const reportPath = resolve(root, '.design-staging/void-tile/report.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    report.blocked = false;
    writeFileSync(reportPath, JSON.stringify(report));
    assert.throws(() => applyAsset('void-tile', root), /obsolete placeholder/);
});

test('preview serves only a read-only snapshot, no filesystem access or writes', async t => {
    const { root } = fixture(t);
    stageAsset('void-tile', tile, root);
    const server = previewServer('void-tile', root);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/candidate.png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), tile);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/report.json', { method: 'POST' })).status, 404);
    assert.equal((await fetch(base + '/report.json')).status, 200);
});
