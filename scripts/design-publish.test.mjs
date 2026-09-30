import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { ROOT, coverage, manifest, sha256 } from './design-assets.mjs';
import { createDesignPublisher } from './design-publish.mjs';

const OWNER = ['-c', 'user.name=tastefinger', '-c', 'user.email=41840333+lukketsvane@users.noreply.github.com'];
const git = (root, args, binary = false) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: binary ? null : 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ref = root => git(root, ['rev-parse', 'HEAD']).trim();

function fixture(t) {
    const directory = mkdtempSync(resolve(tmpdir(), 'garden-publish-test-'));
    const root = resolve(directory, 'checkout');
    const remote = resolve(directory, 'remote.git');
    const publishers = [];
    t.after(async () => {
        for (const publisher of publishers) await publisher.close();
        assert(directory.startsWith(`${resolve(tmpdir())}${sep}garden-publish-test-`));
        rmSync(directory, { recursive: true, force: true });
    });
    mkdirSync(root);
    git(root, ['init', '-q', '-b', 'dev']);
    git(root, ['init', '-q', '--bare', remote]);
    git(root, ['config', 'core.autocrlf', 'false']);
    const asset = structuredClone(coverage.assets.find(asset => asset.path === manifest.assets['roots-icon'].path));
    const other = structuredClone(coverage.assets.find(asset => asset.path === manifest.assets.gnome.path));
    const baseline = readFileSync(resolve(ROOT, asset.path));
    const alternatives = coverage.assets.filter(item => item.format === 'png' && item.width === asset.width && item.height === asset.height)
        .map(item => readFileSync(resolve(ROOT, item.path))).filter(bytes => sha256(bytes) !== sha256(baseline));
    const unique = [...new Map(alternatives.map(bytes => [sha256(bytes), bytes])).values()];
    assert(unique.length >= 2);
    const [candidate, newest] = unique;
    const target = resolve(root, asset.path);
    const indexPath = resolve(root, 'design/asset-map.json');
    mkdirSync(dirname(target), { recursive: true });
    mkdirSync(dirname(indexPath));
    writeFileSync(target, baseline);
    asset.sha256 = sha256(baseline);
    writeFileSync(indexPath, `{\n  "assets": [\n    ${JSON.stringify(asset)},\n    ${JSON.stringify(other)}\n  ]\n}\n`);
    writeFileSync(resolve(root, '.gitignore'), '.design-staging/\n');
    writeFileSync(resolve(root, 'note.txt'), 'baseline note\n');
    writeFileSync(resolve(root, 'staged.txt'), 'baseline staging\n');
    git(root, ['add', '.']);
    git(root, [...OWNER, 'commit', '-qm', 'Baseline']);
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-q', '-u', 'origin', 'dev']);
    const base = ref(root);
    const start = validate => {
        const publisher = createDesignPublisher({ root, delayMs: 10000, validate, allowTestRemote: true });
        publishers.push(publisher);
        return publisher;
    };
    const apply = bytes => {
        writeFileSync(target, bytes);
        const index = JSON.parse(readFileSync(indexPath));
        Object.assign(index.assets[0], { sha256: sha256(bytes), status: 'unverified', figmaSha256: null, figmaImageSha1: null, evidence: null });
        writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
    };
    const published = () => git(root, ['--git-dir', remote, 'rev-parse', 'refs/heads/dev']).trim();
    return { root, remote, asset, other, target, indexPath, baseline, candidate, newest, base, start, apply, published };
}

test('publication coalesces native imports, tests the exact snapshot and preserves unrelated work and staging', async t => {
    const f = fixture(t);
    writeFileSync(resolve(f.root, 'note.txt'), 'independent dirty note\n');
    writeFileSync(resolve(f.root, 'staged.txt'), 'independent staged note\n');
    git(f.root, ['add', 'staged.txt']);
    writeFileSync(resolve(f.root, 'untracked.txt'), 'keep me');
    const validations = [];
    const publisher = f.start(async worktree => {
        validations.push(readFileSync(resolve(worktree, f.asset.path)));
        assert.equal(readFileSync(resolve(worktree, 'note.txt'), 'utf8'), 'baseline note\n');
        assert.equal(readFileSync(resolve(worktree, 'staged.txt'), 'utf8'), 'baseline staging\n');
    });
    f.apply(f.candidate);
    await publisher.enqueue([f.asset.path]);
    const pendingPath = resolve(f.root, '.design-staging/figma-live/pending.json');
    const previousPending = readFileSync(pendingPath);
    f.apply(f.newest);
    const localIndex = JSON.parse(readFileSync(f.indexPath));
    localIndex.assets[1].sourceName = 'independent local mapping';
    writeFileSync(f.indexPath, JSON.stringify(localIndex));
    const saving = publisher.enqueue([f.asset.path]);
    assert.deepEqual(readFileSync(pendingPath), previousPending);
    await saving;
    assert(readdirSync(dirname(pendingPath)).every(path => !path.endsWith('.tmp')));
    const result = await publisher.waitForIdle();
    assert.equal(result.pending, 0);
    assert.equal(validations.length, 1);
    assert.deepEqual(validations[0], f.newest);
    assert.equal(ref(f.root), f.published());
    assert.notEqual(ref(f.root), f.base);
    assert.deepEqual(git(f.root, ['show', `HEAD:${f.asset.path}`], true), f.newest);
    assert.deepEqual(git(f.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).trim().split(/\r?\n/).sort(), ['design/asset-map.json', f.asset.path].sort());
    const committedIndex = JSON.parse(git(f.root, ['show', 'HEAD:design/asset-map.json']));
    assert.equal(git(f.root, ['show', 'HEAD:design/asset-map.json']), git(f.root, ['show', `${f.base}:design/asset-map.json`]).replace(JSON.stringify(f.asset), JSON.stringify(committedIndex.assets[0])));
    assert.deepEqual(committedIndex.assets[1], f.other);
    assert.equal(JSON.parse(readFileSync(f.indexPath)).assets[1].sourceName, 'independent local mapping');
    assert.equal(git(f.root, ['show', ':staged.txt']), 'independent staged note\n');
    assert.equal(readFileSync(resolve(f.root, 'note.txt'), 'utf8'), 'independent dirty note\n');
    assert.equal(readFileSync(resolve(f.root, 'untracked.txt'), 'utf8'), 'keep me');
    assert.equal(git(f.root, ['diff', '--cached', '--name-only']).trim(), 'staged.txt');
    const head = ref(f.root);
    await publisher.enqueue([f.asset.path]);
    await publisher.waitForIdle();
    assert.equal(ref(f.root), head);
    assert.equal(validations.length, 1);
});

test('failed validation never pushes and immutable pending artwork survives a publisher restart', async t => {
    const f = fixture(t);
    const publisher = f.start(async () => { throw new Error('deliberate check failure'); });
    f.apply(f.candidate);
    await publisher.enqueue([f.asset.path]);
    await assert.rejects(publisher.waitForIdle(), /deliberate check failure/);
    assert.equal(ref(f.root), f.base);
    assert.equal(f.published(), f.base);
    const saved = JSON.parse(readFileSync(resolve(f.root, '.design-staging/figma-live/pending.json')));
    assert.deepEqual(Buffer.from(saved.items[0].bytes, 'base64'), f.candidate);
    await publisher.close();
    const resumed = f.start(async () => {});
    await resumed.waitForIdle();
    assert.notEqual(f.published(), f.base);
    assert.equal(resumed.status.pending, 0);
});

test('Windows-length dependency paths are cleaned without masking the validation failure', async t => {
    const f = fixture(t);
    let snapshot;
    const publisher = f.start(async worktree => {
        snapshot = worktree;
        assert.equal(dirname(worktree), resolve(f.root, '.design-staging/p'));
        const dependency = resolve(worktree, 'node_modules', ...Array.from({ length: 20 }, (_, i) => `nested-dependency-${i}`), 'file.js');
        assert(dependency.length > 260);
        mkdirSync(dirname(dependency), { recursive: true });
        writeFileSync(dependency, 'dependency');
        throw new Error('underlying validation failure');
    });
    f.apply(f.candidate);
    await publisher.enqueue([f.asset.path]);
    await assert.rejects(publisher.waitForIdle(), error => error.message === 'underlying validation failure');
    assert.equal(existsSync(snapshot), false);
    assert.equal(f.published(), f.base);
    assert.equal(publisher.status.pending, 1);
});

test('a newer import during checks discards the stale snapshot and publishes only the newest batch', async t => {
    const f = fixture(t);
    let enter, release, validations = 0;
    const entered = new Promise(done => { enter = done; });
    const blocked = new Promise(done => { release = done; });
    const publisher = f.start(async worktree => {
        validations++;
        if (validations === 1) { enter(); await blocked; }
        else assert.deepEqual(readFileSync(resolve(worktree, f.asset.path)), f.newest);
    });
    f.apply(f.candidate);
    await publisher.enqueue([f.asset.path]);
    const waiting = publisher.waitForIdle();
    await entered;
    f.apply(f.newest);
    await publisher.enqueue([f.asset.path]);
    release();
    await waiting;
    assert.equal(validations, 2);
    assert.deepEqual(git(f.root, ['show', `HEAD:${f.asset.path}`], true), f.newest);
    assert.equal(Number(git(f.root, ['rev-list', '--count', `${f.base}..HEAD`])), 1);
});

test('remote dev advancement during checks retains the artwork and never rewrites remote history', async t => {
    const f = fixture(t);
    let remoteCommit;
    const publisher = f.start(async () => {
        const other = resolve(dirname(f.root), 'other');
        git(f.root, ['clone', '-q', '--branch', 'dev', f.remote, other]);
        writeFileSync(resolve(other, 'note.txt'), 'remote progress\n');
        git(other, ['add', 'note.txt']);
        git(other, [...OWNER, 'commit', '-qm', 'Remote progress']);
        git(other, ['push', '-q', 'origin', 'dev']);
        remoteCommit = ref(other);
    });
    f.apply(f.candidate);
    await publisher.enqueue([f.asset.path]);
    await assert.rejects(publisher.waitForIdle(), /origin\/dev advanced/);
    assert.equal(f.published(), remoteCommit);
    assert.equal(ref(f.root), f.base);
    assert.equal(publisher.status.pending, 1);
});

test('already staged artwork or its index blocks publication without changing the existing index', async t => {
    for (const path of ['artwork', 'map']) {
        const f = fixture(t);
        f.apply(f.candidate);
        const staged = path === 'artwork' ? f.asset.path : 'design/asset-map.json';
        git(f.root, ['add', '--', staged]);
        const before = readFileSync(resolve(f.root, '.git/index'));
        const publisher = f.start(async () => assert.fail('Staged artwork must not reach validation.'));
        await publisher.enqueue([f.asset.path]);
        await assert.rejects(publisher.waitForIdle(), /Unstage mapped artwork/);
        assert.deepEqual(readFileSync(resolve(f.root, '.git/index')), before);
        assert.equal(f.published(), f.base);
    }
});

test('validation cannot change the candidate tree or include an unrelated staged file', async t => {
    const f = fixture(t);
    const publisher = f.start(async worktree => {
        writeFileSync(resolve(worktree, 'note.txt'), 'check changed source\n');
        git(worktree, ['add', 'note.txt']);
    });
    f.apply(f.candidate);
    await publisher.enqueue([f.asset.path]);
    await assert.rejects(publisher.waitForIdle(), /Checks modified the captured artwork snapshot/);
    assert.equal(f.published(), f.base);
    assert.equal(ref(f.root), f.base);
});

test('publication rejects foreign origins, feature branches, invalid mapping geometry and malformed PNGs', async t => {
    const f = fixture(t);
    const production = createDesignPublisher({ root: f.root, delayMs: 10000, validate: async () => {} });
    t.after(() => production.close());
    f.apply(f.candidate);
    await production.enqueue([f.asset.path]);
    await assert.rejects(production.waitForIdle(), /cells\.garden origin/);
    await production.close();
    const publisher = f.start(async () => assert.fail('Invalid publication must not reach validation.'));
    git(f.root, ['switch', '-q', '-c', 'feature']);
    await publisher.enqueue([f.asset.path]);
    await assert.rejects(publisher.waitForIdle(), /only on dev/);
    const index = JSON.parse(readFileSync(f.indexPath));
    index.assets[0].width++;
    writeFileSync(f.indexPath, JSON.stringify(index));
    await assert.rejects(publisher.enqueue([f.asset.path]), /mapped native PNG/);
    f.apply(Buffer.from('not PNG'));
    index.assets[0].width--;
    index.assets[0].sha256 = sha256(Buffer.from('not PNG'));
    writeFileSync(f.indexPath, JSON.stringify(index));
    await assert.rejects(publisher.enqueue([f.asset.path]), /PNG/);
    await assert.rejects(publisher.enqueue(['note.txt']), /mapped native PNG/);
    assert.equal(f.published(), f.base);
});
