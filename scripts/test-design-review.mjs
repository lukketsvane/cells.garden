import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, manifest, stageAsset, importAsset, approveAsset, applyAsset, sha256, validatePng } from './design-assets.mjs';
import { buildGardenReview, rendererFingerprint, validateGardenReview } from './design-review.mjs';

const temporary = mkdtempSync(resolve(tmpdir(), 'garden-review-test-'));
const asset = manifest.assets['void-tile'];
const productionBytes = readFileSync(resolve(ROOT, asset.path));
const productionIndex = readFileSync(resolve(ROOT, 'design/asset-map.json'));
const productionFingerprint = rendererFingerprint(ROOT);

function invalidCompressedPng(bytes) {
    const parts = [bytes.subarray(0, 8)];
    let replaced = false;
    for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset);
        if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
            if (replaced) { offset += length + 12; continue; }
            const invalid = Buffer.alloc(13);
            invalid.writeUInt32BE(1, 0);
            invalid.write('IDAT', 4);
            let crc = 0xffffffff;
            for (const byte of invalid.subarray(4, 9)) {
                crc ^= byte;
                for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
            }
            invalid.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 9);
            parts.push(invalid);
            replaced = true;
        } else parts.push(bytes.subarray(offset, offset + length + 12));
        offset += length + 12;
    }
    assert(replaced, 'Test PNG has no IDAT chunk.');
    return Buffer.concat(parts);
}
try {
    for (const input of ['src', 'public', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'design']) {
        cpSync(resolve(ROOT, input), resolve(temporary, input), { recursive: true });
    }
    mkdirSync(resolve(temporary, 'dist'));
    writeFileSync(resolve(temporary, 'dist/sentinel.txt'), 'untouched build');
    execFileSync('git', ['init', '-b', 'review-fixture'], { cwd: temporary, stdio: 'ignore' });
    const invalid = invalidCompressedPng(productionBytes);
    validatePng(invalid, asset);
    stageAsset('void-tile', invalid, temporary);
    await assert.rejects(buildGardenReview('void-tile', { root: temporary }), /image decode failed/i);
    assert.equal(existsSync(resolve(temporary, '.design-staging/void-tile/review.json')), false, 'Broken compressed PNG data must never create review evidence.');
    stageAsset('void-tile', productionBytes, temporary);
    console.log('Review integration: building identical current/candidate gardens.');
    const identical = await buildGardenReview('void-tile', { root: temporary });
    assert.equal(identical.sourceExercised, true, 'Void must be visible in the actual garden fixture.');
    assert.equal(identical.decodedImages.candidate.decoded, true);
    assert(identical.comparisons.every(comparison => comparison.changedPixels === 0), 'Identical artwork must produce pixel-identical real garden screenshots.');
    assert(identical.comparisons.every(comparison => comparison.beforeScene.plants === 1 && comparison.beforeScene.cells > 10));
    assert.equal(validateGardenReview('void-tile', { root: temporary }).candidateSha256, sha256(productionBytes));
    assert.equal(readFileSync(resolve(temporary, 'dist/sentinel.txt'), 'utf8'), 'untouched build');
    assert.deepEqual(readFileSync(resolve(temporary, asset.path)), productionBytes);

    const browser = await chromium.launch({ headless: true });
    let synthetic;
    let syntheticGnome;
    try {
        const page = await browser.newPage();
        synthetic = Buffer.from(await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fa2070'; ctx.fillRect(0, 0, 32, 32);
            ctx.fillStyle = '#20fa70'; ctx.fillRect(0, 0, 16, 16); ctx.fillRect(16, 16, 16, 16);
            return canvas.toDataURL('image/png').split(',')[1];
        }), 'base64');
        syntheticGnome = Buffer.from(await page.evaluate(({ width, height }) => {
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fa2070'; ctx.fillRect(0, 0, width, height);
            return canvas.toDataURL('image/png').split(',')[1];
        }, manifest.assets.gnome), 'base64');
    } finally { await browser.close(); }
    const exported = resolve(temporary, 'synthetic-export.png');
    writeFileSync(exported, synthetic);
    importAsset('void-tile', exported, temporary);
    assert.throws(() => validateGardenReview('void-tile', { root: temporary }), /artwork changed/);
    console.log('Review integration: building changed current/candidate gardens.');
    const changed = await buildGardenReview('void-tile', { root: temporary });
    assert.equal(changed.sourceExercised, true);
    assert(changed.comparisons.every(comparison => comparison.changedPixels > 0), 'A changed void must change both actual desktop and mobile garden screenshots.');
    assert.deepEqual(readFileSync(resolve(temporary, asset.path)), productionBytes, 'Review must never apply candidate artwork.');
    assert.equal(readFileSync(resolve(temporary, 'dist/sentinel.txt'), 'utf8'), 'untouched build');

    const gnome = manifest.assets.gnome;
    const gnomeBytes = readFileSync(resolve(ROOT, gnome.path));
    stageAsset('gnome', syntheticGnome, temporary);
    console.log('Review integration: building changed gnome gardens.');
    const gnomeReview = await buildGardenReview('gnome', { root: temporary });
    assert.equal(gnomeReview.sourceExercised, true, 'Gnome must be visible in both actual garden viewports.');
    assert(gnomeReview.comparisons.every(comparison => comparison.changedPixels > 0), 'Changed gnome artwork must change both garden screenshots.');
    const gnomeFixture = JSON.parse(readFileSync(resolve(temporary, '.design-staging/gnome', gnomeReview.files.find(file => file.kind === 'fixture').path), 'utf8'));
    assert.deepEqual(gnomeFixture.settings.items, [{ id: 'review_gnome', kind: 'gnome', x: -0.5 }]);
    assert.equal(approveAsset('gnome', { sha256: sha256(syntheticGnome), note: 'Synthetic gnome reviewed in both garden viewports.' }, temporary).candidateSha256, sha256(syntheticGnome));
    assert.deepEqual(readFileSync(resolve(temporary, gnome.path)), gnomeBytes);
    assert.deepEqual(readFileSync(resolve(ROOT, gnome.path)), gnomeBytes);

    const stage = resolve(temporary, '.design-staging/void-tile');
    const evidence = resolve(stage, changed.files.find(file => file.kind === 'after').path);
    const evidenceBytes = readFileSync(evidence);
    writeFileSync(evidence, Buffer.concat([evidenceBytes, Buffer.from('changed')]));
    assert.throws(() => validateGardenReview('void-tile', { root: temporary }), /evidence changed/);
    writeFileSync(evidence, evidenceBytes);
    const rendererPath = resolve(temporary, 'src/core/styles.css');
    const rendererBytes = readFileSync(rendererPath);
    writeFileSync(rendererPath, Buffer.concat([rendererBytes, Buffer.from('\n/* review invalidation fixture */\n')]));
    assert.throws(() => validateGardenReview('void-tile', { root: temporary }), /renderer changed/);
    writeFileSync(rendererPath, rendererBytes);
    validateGardenReview('void-tile', { root: temporary });

    assert.throws(() => approveAsset('void-tile', { sha256: '0'.repeat(64), note: 'Test review approval' }, temporary), /exact staged SHA256/);
    const approval = approveAsset('void-tile', { sha256: sha256(synthetic), note: 'Synthetic fixture reviewed at desktop and mobile sizes.' }, temporary);
    assert.equal(approval.candidateSha256, sha256(synthetic));
    for (const protectedBranch of ['main', 'original']) {
        execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${protectedBranch}`], { cwd: temporary });
        assert.throws(() => applyAsset('void-tile', temporary), /never main or original/);
        assert.deepEqual(readFileSync(resolve(temporary, asset.path)), productionBytes);
    }
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/review-fixture'], { cwd: temporary });
    assert.equal(applyAsset('void-tile', temporary), asset.path);
    assert.deepEqual(readFileSync(resolve(temporary, asset.path)), synthetic);
    const index = JSON.parse(readFileSync(resolve(temporary, 'design/asset-map.json'), 'utf8'));
    assert.equal(index.assets.find(entry => entry.path === asset.path).sha256, sha256(synthetic));
    assert(existsSync(resolve(temporary, 'design/changes', `void-tile-${sha256(synthetic)}-${sha256(Buffer.from(JSON.stringify(approval)))}.json`)));
    assert.deepEqual(readFileSync(resolve(ROOT, asset.path)), productionBytes);
    assert.deepEqual(readFileSync(resolve(ROOT, 'design/asset-map.json')), productionIndex);
    assert.equal(rendererFingerprint(ROOT), productionFingerprint);
    console.log('Garden review passed: actual desktop/mobile renders, identical and changed pixels, isolated sources/builds, evidence/context invalidation, explicit approval and branch-scoped apply.');
} finally {
    const resolved = realpathSync(temporary);
    assert(resolved.startsWith(`${realpathSync(tmpdir())}${sep}`));
    rmSync(resolved, { recursive: true, force: true });
}
