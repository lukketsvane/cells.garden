import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename as renameFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { ROOT, coverage, manifest, sha256 } from './design-assets.mjs';
import { syncDesignExport } from './design-dev.mjs';

function fixture(t) {
    const root = mkdtempSync(resolve(tmpdir(), 'garden-export-sync-'));
    t.after(() => {
        assert(root.startsWith(`${resolve(tmpdir())}${sep}garden-export-sync-`));
        rmSync(root, { recursive: true, force: true });
    });
    const asset = manifest.assets['roots-icon'];
    const baseline = readFileSync(resolve(ROOT, asset.path));
    const alternate = coverage.assets.find(item => item.format === 'png' && item.width === asset.width && item.height === asset.height && item.sha256 !== sha256(baseline));
    assert(alternate);
    const candidate = readFileSync(resolve(ROOT, alternate.path));
    const target = resolve(root, asset.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, baseline);
    mkdirSync(resolve(root, 'design'));
    const unrelated = { path: 'src/assets/unrelated.png', sha256: 'untouched' };
    const index = { assets: [{ path: asset.path, sha256: sha256(baseline), status: 'source-verified' }, unrelated] };
    const indexPath = resolve(root, 'design/asset-map.json');
    writeFileSync(indexPath, JSON.stringify(index));
    const exported = resolve(root, 'export.png');
    writeFileSync(exported, candidate);
    return { root, asset, target, baseline, candidate, indexPath, unrelated, exported };
}

test('direct export sync preserves native bytes, updates only its index entry and rejects independent edits', async t => {
    const { root, asset, target, baseline, candidate, indexPath, unrelated, exported } = fixture(t);
    assert.deepEqual(await syncDesignExport(exported, { root, asset: 'roots-icon' }), [asset.path]);
    assert.deepEqual(readFileSync(target), candidate);
    const updated = JSON.parse(readFileSync(indexPath));
    assert.equal(updated.assets[0].sha256, sha256(candidate));
    assert.equal(updated.assets[0].status, 'unverified');
    assert.deepEqual(updated.assets[1], unrelated);
    assert.deepEqual(await syncDesignExport(exported, { root, asset: 'roots-icon' }), []);
    writeFileSync(target, baseline);
    const savedIndex = readFileSync(indexPath);
    await assert.rejects(syncDesignExport(exported, { root, asset: 'roots-icon' }), /outside the mapped export/);
    assert.deepEqual(readFileSync(target), baseline);
    assert.deepEqual(readFileSync(indexPath), savedIndex);
});

test('temporary Windows index locks retry without blocking and remove save files', async t => {
    const { root, asset, target, candidate, indexPath, exported } = fixture(t);
    let attempts = 0, ticked = false;
    const tick = setTimeout(() => { ticked = true; }, 10);
    t.after(() => clearTimeout(tick));
    const rename = async (from, to) => {
        if (to === indexPath && attempts++ < 3) throw Object.assign(new Error('Temporary scanner lock'), { code: attempts % 2 ? 'EPERM' : 'EBUSY' });
        return renameFile(from, to);
    };
    assert.deepEqual(await syncDesignExport(exported, { root, asset: 'roots-icon', rename }), [asset.path]);
    assert(ticked, 'A locked save must yield to the dev server event loop.');
    assert.equal(attempts, 4);
    assert.deepEqual(readFileSync(target), candidate);
    assert.equal(JSON.parse(readFileSync(indexPath)).assets[0].sha256, sha256(candidate));
    assert(!readdirSync(root, { recursive: true }).some(path => path.endsWith('.tmp')));
});

test('exhausted Windows retries roll artwork back and permanent errors are not retried', async t => {
    for (const code of ['EPERM', 'EACCES']) {
        const { root, target, baseline, indexPath, exported } = fixture(t);
        const indexBytes = readFileSync(indexPath);
        let attempts = 0;
        const rename = async (from, to) => {
            if (to === indexPath) { attempts++; throw Object.assign(new Error('Index unavailable'), { code }); }
            return renameFile(from, to);
        };
        await assert.rejects(syncDesignExport(exported, { root, asset: 'roots-icon', rename }), error => error.code === code);
        assert.equal(attempts, code === 'EPERM' ? 11 : 1);
        assert.deepEqual(readFileSync(target), baseline);
        assert.deepEqual(readFileSync(indexPath), indexBytes);
        assert(!readdirSync(root, { recursive: true }).some(path => path.endsWith('.tmp')));
    }
});

test('overlapping exports serialize so both source hashes survive a delayed index save', async t => {
    const { root, candidate, indexPath, exported } = fixture(t);
    const stem = manifest.assets['stem-icon'];
    const stemPath = resolve(root, stem.path);
    const stemBytes = readFileSync(resolve(ROOT, stem.path));
    writeFileSync(stemPath, stemBytes);
    const index = JSON.parse(readFileSync(indexPath));
    index.assets.push({ path: stem.path, sha256: sha256(stemBytes) });
    writeFileSync(indexPath, JSON.stringify(index));
    const stemExport = resolve(root, 'stem.png');
    writeFileSync(stemExport, candidate);
    let release, reached;
    const locked = new Promise(done => { release = done; });
    const saving = new Promise(done => { reached = done; });
    const first = syncDesignExport(exported, { root, asset: 'roots-icon', rename: async (from, to) => {
        if (to === indexPath) { reached(); await locked; }
        return renameFile(from, to);
    } });
    await saving;
    const second = syncDesignExport(stemExport, { root, asset: 'stem-icon' });
    await new Promise(done => setImmediate(done));
    assert.deepEqual(readFileSync(stemPath), stemBytes);
    release();
    await Promise.all([first, second]);
    const updated = JSON.parse(readFileSync(indexPath));
    for (const path of [manifest.assets['roots-icon'].path, stem.path]) assert.equal(updated.assets.find(item => item.path === path).sha256, sha256(candidate));
    assert.deepEqual(readFileSync(stemPath), candidate);
});
