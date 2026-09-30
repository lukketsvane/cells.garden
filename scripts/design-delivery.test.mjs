import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { assertSuccessfulDevCI, comparePublishedArtwork, executeDelivery, inspectDelivery, parseDeliveryArgs, preparedReviewDigest, validateArtworkChange } from './design-delivery.mjs';

const OWNER = ['-c', 'user.name=tastefinger', '-c', 'user.email=41840333+lukketsvane@users.noreply.github.com'];
const digest = value => createHash('sha256').update(value).digest('hex');
const oldBytes = Buffer.from('baseline image bytes');
const newBytes = Buffer.from('reviewed image bytes');
const assetPath = 'src/assets/tile.png';
const receiptFile = receipt => `design/changes/tile-${receipt.candidateSha256}-${digest(JSON.stringify(receipt))}.json`;
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function changeFixture() {
    const before = { fileKey: 'file', capturedAt: '2026-09-30', assets: [{ path: assetPath, format: 'png', width: 1, height: 1,
        sha256: digest(oldBytes), status: 'source-verified', sourceNodeId: '1:2', sourceName: 'Source/Tile', exportNodeId: '1:3', exportName: assetPath,
        figmaSha256: null, figmaImageSha1: 'source-digest', evidence: 'source-image-sha1-and-linked-export' }] };
    const after = structuredClone(before);
    Object.assign(after.assets[0], { sha256: digest(newBytes), status: 'unverified', figmaSha256: null, figmaImageSha1: null, evidence: 'approved-artwork-review' });
    const manifest = { fileKey: 'file', assets: { tile: { path: assetPath, sourceNodeId: '1:2', exportNodeId: '1:3', width: 1, height: 1 } } };
    const receipt = { schema: 'reviewed-artwork-v1', version: 1, asset: 'tile', path: assetPath, fileKey: 'file', sourceNodeId: '1:2', exportNodeId: '1:3',
        baselineSha256: digest(oldBytes), candidateSha256: digest(newBytes), note: 'Approve the brighter pixel after reviewing both garden sizes.', approvedAt: '2026-09-30T14:00:00.000Z',
        reviewSha256: digest('review'), rendererSha256: digest('renderer'), provenance: { kind: 'manual-export' }, reviewFiles: [{ path: 'desktop.png', sha256: digest('screenshot') }] };
    const receiptPath = receiptFile(receipt);
    const changes = [{ status: 'M', path: assetPath }, { status: 'M', path: 'design/asset-map.json' }, { status: 'A', path: receiptPath }];
    return { before, after, manifest, receipt, receiptPath, changes, readBefore: () => oldBytes,
        readAfter: path => path === assetPath ? newBytes : Buffer.from(JSON.stringify(receipt)) };
}

function repositoryFixture(t, mutate = () => {}, directoryPrefix = 'garden-delivery-test-') {
    const root = mkdtempSync(join(tmpdir(), directoryPrefix));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    git(root, ['init', '-b', 'main']);
    const write = (path, value) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), typeof value === 'object' && !Buffer.isBuffer(value) ? `${JSON.stringify(value)}\n` : value);
    };
    const commit = message => { git(root, ['add', '.']); git(root, [...OWNER, 'commit', '-m', message]); return git(root, ['rev-parse', 'HEAD']); };
    const fixture = changeFixture();
    write(assetPath, oldBytes);
    write('design/asset-map.json', fixture.before);
    write('design/figma-assets.json', fixture.manifest);
    write('src/core/styles.css', '.garden { image-rendering: pixelated; }\n');
    const baseline = commit('Initial approved artwork');
    git(root, ['update-ref', 'refs/remotes/origin/main', baseline]);
    git(root, ['update-ref', 'refs/remotes/origin/dev', baseline]);
    mutate(fixture);
    write(assetPath, newBytes);
    write('design/asset-map.json', fixture.after);
    write(fixture.receiptPath, fixture.receipt);
    const artwork = commit('Update approved tile');
    return { root, write, commit, baseline, artwork, fixture };
}

test('delivery is a local plan unless preparation or publication is explicit', () => {
    const commit = 'a'.repeat(40);
    assert.deepEqual(parseDeliveryArgs(['--target', 'dev', '--commit', commit]), { target: 'dev', commit, mode: 'plan' });
    assert.equal(parseDeliveryArgs(['--target', 'main', '--commit', commit, '--publish']).mode, 'publish');
    assert.equal(parseDeliveryArgs(['--prepare', '--target', 'dev', '--commit', commit]).mode, 'prepare');
    for (const args of [[], ['--target', 'original', '--commit', commit], ['--target', 'main', '--commit', 'HEAD'],
        ['--target', 'dev', '--commit', commit, '--prepare', '--publish'], ['--target', 'dev', '--commit', commit, '--force'],
        ['--target', 'dev', '--commit', commit, '--target', 'main']]) assert.throws(() => parseDeliveryArgs(args));
});

test('resuming a target review requires explicit publication, the exact review hash and a decision note', () => {
    const args = ['--prepared', '/review', '--publish', '--review-sha256', 'a'.repeat(64), '--note', 'Reviewed the target garden.'];
    assert.equal(parseDeliveryArgs(args).prepared, '/review');
    assert.equal(parseDeliveryArgs(args).reviewSha256, 'a'.repeat(64));
    for (const invalid of [args.filter(arg => arg !== '--publish'), args.slice(0, -2), [...args, '--target', 'main'],
        ['--prepared', '/review', '--publish', '--review-sha256', 'wrong', '--note', 'Reviewed.']]) assert.throws(() => parseDeliveryArgs(invalid));
    const state = { target: 'dev', targetSha: 'a'.repeat(40), commit: 'b'.repeat(40), reviews: [{ asset: 'tile', candidateSha256: 'c'.repeat(64), reviewSha256: 'd'.repeat(64) }] };
    const accepted = preparedReviewDigest(state);
    assert.notEqual(preparedReviewDigest({ ...state, target: 'main' }), accepted);
    assert.notEqual(preparedReviewDigest({ ...state, targetSha: 'e'.repeat(40) }), accepted);
    assert.notEqual(preparedReviewDigest({ ...state, reviews: [{ ...state.reviews[0], reviewSha256: 'f'.repeat(64) }] }), accepted);
});

test('a receipt binds an artwork change to exact old bytes, new bytes, source nodes and review evidence', () => {
    const fixture = changeFixture();
    const approved = validateArtworkChange(fixture);
    assert.equal(approved[0].baselineSha256, digest(oldBytes));
    assert.equal(approved[0].candidateSha256, digest(newBytes));
    for (const [key, value] of [['candidateSha256', digest('wrong')], ['baselineSha256', digest('wrong')], ['sourceNodeId', '2:3'],
        ['fileKey', 'another-file'], ['schema', 'unknown'], ['reviewSha256', ''], ['note', ''], ['reviewFiles', [{ path: '../outside.png', sha256: digest('screenshot') }]]]) {
        const changed = changeFixture();
        changed.receipt[key] = value;
        changed.changes[2].path = receiptFile(changed.receipt);
        assert.throws(() => validateArtworkChange(changed), /Approval|approval|fingerprint|evidence/);
    }
});

test('delivery rejects unrelated changes, rewritten receipts and source-map changes', () => {
    const unrelated = changeFixture();
    unrelated.changes.push({ status: 'M', path: 'src/core/styles.css' });
    assert.throws(() => validateArtworkChange(unrelated), /only indexed PNGs/);
    const rewritten = changeFixture();
    rewritten.changes[2].status = 'M';
    assert.throws(() => validateArtworkChange(rewritten), /receipt rewrites/);
    const remapped = changeFixture();
    remapped.after.assets[0].exportNodeId = '9:9';
    assert.throws(() => validateArtworkChange(remapped), /source mappings/);
    const deleted = changeFixture();
    deleted.changes[0].status = 'D';
    assert.throws(() => validateArtworkChange(deleted), /deletions/);
    const omitted = changeFixture();
    omitted.changes.pop();
    assert.throws(() => validateArtworkChange(omitted), /exactly one/);
});

test('new approval identities permit restoring earlier artwork without rewriting its old receipt', () => {
    const fixture = changeFixture();
    const firstReceipt = fixture.receiptPath;
    fixture.receipt.baselineSha256 = digest('intervening artwork');
    fixture.receipt.approvedAt = '2026-10-01T14:00:00.000Z';
    fixture.before.assets[0].sha256 = fixture.receipt.baselineSha256;
    fixture.readBefore = () => Buffer.from('intervening artwork');
    fixture.changes[2].path = receiptFile(fixture.receipt);
    assert.notEqual(fixture.changes[2].path, firstReceipt);
    assert.equal(validateArtworkChange(fixture)[0].candidateSha256, digest(newBytes));
});

test('the local planner reads the selected commit, leaves the checkout untouched, and needs no remote', t => {
    const fixture = repositoryFixture(t);
    fixture.write('unrelated-work.txt', 'Keep this local work.\n');
    const beforeStatus = git(fixture.root, ['status', '--porcelain']);
    const plan = executeDelivery(fixture.root, { target: 'dev', commit: fixture.artwork, mode: 'plan' });
    assert.equal(plan.targetSha, fixture.baseline);
    assert.equal(plan.commit, fixture.artwork);
    assert.equal(plan.approved[0].path, assetPath);
    assert.equal(plan.mode, 'plan');
    assert.equal(git(fixture.root, ['status', '--porcelain']), beforeStatus);
    assert.equal(readFileSync(join(fixture.root, 'unrelated-work.txt'), 'utf8'), 'Keep this local work.\n');
});

test('approval receipts remain readable from long Windows worktree paths', t => {
    const fixture = repositoryFixture(t, () => {}, 'garden-delivery-long-path-long-path-long-path-');
    if (process.platform === 'win32') assert(join(fixture.root, `${fixture.artwork}:${fixture.fixture.receiptPath}`).length > 260);
    const plan = inspectDelivery(fixture.root, { target: 'dev', commit: fixture.artwork });
    assert.equal(plan.approved[0].receiptPath, fixture.fixture.receiptPath);
    assert.equal(plan.approved[0].candidateSha256, digest(newBytes));
});

test('an artwork commit cannot smuggle renderer or application changes into delivery', t => {
    const fixture = repositoryFixture(t);
    fixture.write('src/core/styles.css', '.garden { color: red; }\n');
    git(fixture.root, ['add', '.']);
    git(fixture.root, [...OWNER, 'commit', '--amend', '--no-edit']);
    const commit = git(fixture.root, ['rev-parse', 'HEAD']);
    assert.throws(() => inspectDelivery(fixture.root, { target: 'dev', commit }), /only indexed PNGs/);
});

test('target artwork or scene changes require a fresh review instead of overwriting them', t => {
    const fixture = repositoryFixture(t);
    git(fixture.root, ['switch', '-c', 'target-progress', fixture.baseline]);
    fixture.write(assetPath, Buffer.from('new work by another contributor'));
    const newer = fixture.commit('Update target artwork');
    git(fixture.root, ['update-ref', 'refs/remotes/origin/dev', newer]);
    assert.throws(() => inspectDelivery(fixture.root, { target: 'dev', commit: fixture.artwork }), /Target artwork changed/);
    assert.doesNotThrow(() => inspectDelivery(fixture.root, { target: 'dev', commit: fixture.artwork }, { targetReview: true }));
    git(fixture.root, ['switch', '-c', 'scene-progress', fixture.baseline]);
    fixture.write('src/core/styles.css', '.garden { z-index: 5; }\n');
    const scene = fixture.commit('Update scene ordering');
    git(fixture.root, ['update-ref', 'refs/remotes/origin/dev', scene]);
    assert.throws(() => inspectDelivery(fixture.root, { target: 'dev', commit: fixture.artwork }), /garden differs from the reviewed scene/);
    const reviewedPlan = inspectDelivery(fixture.root, { target: 'dev', commit: fixture.artwork }, { targetReview: true });
    assert.deepEqual(reviewedPlan.sceneChanges, ['src/core/styles.css']);
    assert.equal(readFileSync(join(fixture.root, assetPath), 'utf8'), oldBytes.toString());
});

test('main promotion requires exact approved artwork and its receipt on dev', t => {
    const fixture = repositoryFixture(t);
    assert.throws(() => inspectDelivery(fixture.root, { target: 'main', commit: fixture.artwork }), /exact approved artwork/);
    git(fixture.root, ['update-ref', 'refs/remotes/origin/dev', fixture.artwork]);
    const plan = inspectDelivery(fixture.root, { target: 'main', commit: fixture.artwork });
    assert.equal(plan.devSha, fixture.artwork);
    assert.equal(plan.targetSha, fixture.baseline);
});

test('main promotion follows exact reviewed artifacts across cherry-picks and later dev commits', t => {
    const fixture = repositoryFixture(t);
    git(fixture.root, ['switch', '-c', 'development', fixture.baseline]);
    fixture.write(assetPath, newBytes);
    fixture.write('design/asset-map.json', fixture.fixture.after);
    fixture.write(fixture.fixture.receiptPath, fixture.fixture.receipt);
    const cherryPicked = fixture.commit('Deliver the approved tile to development');
    assert.notEqual(cherryPicked, fixture.artwork);
    fixture.write('unrelated-dev-feature.txt', 'This work must not be promoted with the artwork.\n');
    const devHead = fixture.commit('Continue development');
    git(fixture.root, ['update-ref', 'refs/remotes/origin/dev', devHead]);
    const plan = inspectDelivery(fixture.root, { target: 'main', commit: fixture.artwork });
    assert.equal(plan.devSha, devHead);
    assert(!plan.changedPaths.includes('unrelated-dev-feature.txt'));
    fixture.write(fixture.fixture.receiptPath, { ...fixture.fixture.receipt, note: 'Changed after approval' });
    const altered = fixture.commit('Alter the approval record');
    git(fixture.root, ['update-ref', 'refs/remotes/origin/dev', altered]);
    assert.throws(() => inspectDelivery(fixture.root, { target: 'main', commit: fixture.artwork }), /unchanged, valid approval receipt/);
    const targetApproval = { ...fixture.fixture.receipt, note: 'Separately reviewed in the development scene.', approvedAt: '2026-10-01T14:00:00.000Z', reviewSha256: digest('separate dev review') };
    fixture.write(receiptFile(targetApproval), targetApproval);
    const reviewedDev = fixture.commit('Record the independent development review');
    git(fixture.root, ['update-ref', 'refs/remotes/origin/dev', reviewedDev]);
    assert.equal(inspectDelivery(fixture.root, { target: 'main', commit: fixture.artwork }).devSha, reviewedDev);
});

test('latest successful CI must belong to an exact dev push, not a PR or another commit', () => {
    const commit = 'a'.repeat(40);
    const success = { databaseId: 1, headSha: commit, headBranch: 'dev', event: 'push', status: 'completed', conclusion: 'success' };
    assert.equal(assertSuccessfulDevCI([success], commit), success);
    for (const runs of [[], [{ ...success, headSha: 'b'.repeat(40) }], [{ ...success, event: 'pull_request' }],
        [{ ...success, headBranch: 'main' }], [success, { ...success, databaseId: 2, status: 'in_progress', conclusion: null }],
        [success, { ...success, databaseId: 2, conclusion: 'failure' }]]) assert.throws(() => assertSuccessfulDevCI(runs, commit), /exact commit on dev/);
});

test('published visual changes by Max stop delivery until their branch bytes are reconciled', t => {
    const fixture = repositoryFixture(t);
    assert.doesNotThrow(() => comparePublishedArtwork(fixture.root, fixture.baseline));
    git(fixture.root, ['switch', '-c', 'published-artwork', fixture.baseline]);
    fixture.write('src/core/styles.css', '.garden { z-index: 8; }\n');
    git(fixture.root, ['add', '.']);
    git(fixture.root, [...OWNER, 'commit', '--author', 'scubcoral <kr4vler@gmail.com>', '-m', 'Refine scene ordering']);
    const published = git(fixture.root, ['rev-parse', 'HEAD']);
    git(fixture.root, ['update-ref', 'refs/remotes/origin/artwork', published]);
    assert.throws(() => comparePublishedArtwork(fixture.root, fixture.baseline), /Max needs reconciliation.*\n[a-f0-9]+: src\/core\/styles.css/);
    assert.deepEqual(comparePublishedArtwork(fixture.root, fixture.baseline, { paths: [assetPath] }).warnings.map(item => item.path), ['src/core/styles.css']);
    assert.doesNotThrow(() => comparePublishedArtwork(fixture.root, published));
});
