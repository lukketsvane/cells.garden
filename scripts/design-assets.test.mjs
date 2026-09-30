import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import { ROOT, manifest, coverage, assetKey, assetByName, validatePng, validateExport, imageUrl, parseRpc, createFigmaClient, stageAsset, importAsset, pullAsset, approveAsset, applyAsset, previewServer, sha256, withDesignLock } from './design-assets.mjs';

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

test('reconciled non-manifest assets use their actual linked exports', () => {
    const background = assetByName('bg_image');
    assert.equal(background.sourceNodeId, '29:3203');
    assert.equal(background.exportNodeId, '186:413');
    assert.equal(background.exportName, 'src/assets/bg_image.png');
    validateExport(context('<instance id="186:413" name="src/assets/bg_image.png" width="540" height="108" />'), background);
    assert.throws(() => validateExport(context('<symbol id="29:3203" name="Source/Environment/Background" width="540" height="108" />'), background), /does not match/);
    for (const entry of coverage.assets.filter(asset => asset.exportNodeId && asset.exportName)) {
        const resolved = assetByName(assetKey(entry.path));
        assert.equal(resolved.exportNodeId, entry.exportNodeId);
        assert.equal(resolved.exportName ?? resolved.path, entry.exportName);
    }
});

test('source-only fallback keeps a complete source pair and rejects partial export mappings', () => {
    const source = { path: 'src/assets/source-only.png', sourceNodeId: '1:2', sourceName: 'Source/Test', exportNodeId: null, exportName: null };
    const resolved = assetByName('source-only', [source]);
    assert.equal(resolved.exportNodeId, source.sourceNodeId);
    assert.equal(resolved.exportName, source.sourceName);
    assert.equal(source.exportNodeId, null);
    for (const partial of [{ ...source, exportNodeId: '1:3' }, { ...source, exportName: source.path }]) {
        assert.throws(() => assetByName('source-only', [partial]), /Incomplete export mapping/);
    }
    const absent = assetByName('source-only', [{ ...source, sourceNodeId: null, sourceName: null }]);
    assert.equal(absent.exportNodeId, null);
    assert.equal(absent.exportName, null);
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

test('different artwork is blocked by default even after staging against the current baseline', t => {
    const { root, path } = fixture(t);
    const current = readFileSync(resolve(ROOT, 'src/assets/ground_tile.png'));
    writeFileSync(path, current);
    const report = stageAsset('void-tile', tile, root);
    assert.equal(report.blocked, true);
    assert.equal(report.identical, false);
    assert.throws(() => applyAsset('void-tile', root), /Visual preservation/);
    assert.deepEqual(readFileSync(path), current);
});

test('native export import preserves bytes and records manual, not live, provenance', t => {
    const { root, path } = fixture(t);
    const nativeExport = resolve(root, 'native-export.png');
    writeFileSync(nativeExport, tile);
    const report = importAsset('void-tile', nativeExport, root);
    assert.equal(report.provenance.kind, 'manual-export');
    assert.deepEqual(readFileSync(path), tile);
    assert.deepEqual(readFileSync(resolve(root, '.design-staging/void-tile/candidate.png')), tile);
    assert.throws(() => importAsset('CG_logo_v1', nativeExport, root), /mapped native PNG/);
});

test('changed artwork cannot be approved with a guessed hash or without a real garden review', t => {
    const { root, path } = fixture(t);
    writeFileSync(path, readFileSync(resolve(ROOT, 'src/assets/ground_tile.png')));
    stageAsset('void-tile', tile, root);
    assert.throws(() => approveAsset('void-tile', { sha256: '0'.repeat(64), note: 'Reviewed' }, root), /exact staged/);
    assert.throws(() => approveAsset('void-tile', { sha256: sha256(tile), note: '' }, root), /review note/);
    assert.throws(() => approveAsset('void-tile', { sha256: sha256(tile), note: 'Reviewed' }, root));
    assert.throws(() => applyAsset('void-tile', root), /explicit SHA256 approval/);
});

test('repulling invalidates earlier approval rather than carrying it to a new candidate', t => {
    const { root } = fixture(t);
    stageAsset('void-tile', tile, root);
    const approvalPath = resolve(root, '.design-staging/void-tile/approval.json');
    writeFileSync(approvalPath, JSON.stringify({ note: 'Previous candidate' }));
    stageAsset('void-tile', tile, root);
    assert.throws(() => readFileSync(approvalPath), /ENOENT/);
});

test('workspace-wide locking prevents overlapping stage, approval and apply transactions', t => {
    const { root, path } = fixture(t);
    stageAsset('void-tile', tile, root);
    withDesignLock(root, () => {
        assert.throws(() => stageAsset('void-tile', tile, root), /Another artwork operation/);
        assert.throws(() => applyAsset('void-tile', root), /Another artwork operation/);
        assert.throws(() => approveAsset('void-tile', { sha256: sha256(tile), note: 'Reviewed' }, root), /Another artwork operation/);
    });
    assert.equal(applyAsset('void-tile', root), manifest.assets['void-tile'].path);
    assert.deepEqual(readFileSync(path), tile);
    assert.throws(() => withDesignLock(root, () => { throw new Error('Simulated failure'); }), /Simulated failure/);
    assert.equal(applyAsset('void-tile', root), manifest.assets['void-tile'].path);
});

test('the full MCP pull validates metadata, downloads exact bytes and stages the candidate', async t => {
    const { root, path } = fixture(t);
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push(url);
        if (url === 'http://localhost:3845/assets/abc123.png') return new Response(tile);
        assert.equal(url, 'http://127.0.0.1:3845/mcp');
        if (options.method === 'DELETE') return new Response(null, { status: 202 });
        const request = JSON.parse(options.body);
        if (!request.id) return new Response(null, { status: 202 });
        const result = request.params?.name === 'get_metadata'
            ? context('<frame id="253:411" name="src/assets/void_tile.png" width="32" height="32" />')
            : request.params?.name === 'get_design_context'
                ? context('const image = "http://localhost:3845/assets/abc123.png";') : {};
        return new Response(JSON.stringify({ id: request.id, result }));
    };
    const report = await pullAsset('void-tile', { root, fetcher });
    assert.equal(report.provenance.kind, 'figma-mcp');
    assert.equal(report.candidateSha256, sha256(tile));
    assert(calls.includes('http://localhost:3845/assets/abc123.png'));
    assert.deepEqual(readFileSync(path), tile);
});

test('a limited Figma pull fails explicitly and never substitutes a saved candidate', async t => {
    const { root } = fixture(t);
    stageAsset('void-tile', tile, root);
    const reportPath = resolve(root, '.design-staging/void-tile/report.json');
    const saved = readFileSync(reportPath);
    const fetcher = async (_url, options) => {
        const request = JSON.parse(options.body);
        return new Response(JSON.stringify({ id: request.id, error: { message: 'Rate limit exceeded, please try again tomorrow' } }));
    };
    await assert.rejects(pullAsset('void-tile', { root, fetcher }), /Existing candidates were retained.*\n?.*design:import/s);
    assert.deepEqual(readFileSync(reportPath), saved);
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
