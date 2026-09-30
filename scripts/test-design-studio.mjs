// Exercise the local review desk with real artwork builds and a local publication fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, manifest, sha256 } from './design-assets.mjs';
import { validateArtworkChange } from './design-delivery.mjs';
import { buildGardenReview } from './design-review.mjs';
import { createStudioServer } from './design-studio.mjs';

const temporary = mkdtempSync(resolve(tmpdir(), 'garden-studio-test-'));
const asset = manifest.assets['void-tile'];
const productionBytes = readFileSync(resolve(ROOT, asset.path));
const productionIndex = readFileSync(resolve(ROOT, 'design/asset-map.json'));
const owner = ['-c', 'user.name=tastefinger', '-c', 'user.email=41840333+lukketsvane@users.noreply.github.com'];
const reviewUrl = 'https://github.com/example/review-fixture/pull/1';
const note = 'Native checkerboard reviewed in the desktop and mobile gardens.';
const git = (args, cwd = temporary) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const blob = (ref, path, cwd) => execFileSync('git', ['cat-file', 'blob', `${ref}:${path}`], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, studio, synthetic, baselineCommit;
let publicationCalls = 0, reviewCalls = 0;
let releaseReview;
const reviewGate = new Promise(done => { releaseReview = done; });

function containedTemporary(path) {
    const checked = realpathSync(path);
    const temporaryRoot = realpathSync(tmpdir());
    assert(checked.startsWith(`${temporaryRoot}${sep}`), `Refusing cleanup outside the temporary directory: ${checked}`);
    return checked;
}

function assertUnchangedOrigins() {
    assert.deepEqual(readFileSync(resolve(ROOT, asset.path)), productionBytes, 'Studio must not change production artwork.');
    assert.deepEqual(readFileSync(resolve(ROOT, 'design/asset-map.json')), productionIndex, 'Studio must not change the production index.');
    assert.deepEqual(readFileSync(resolve(temporary, asset.path)), productionBytes, 'The dev checkout must retain its original artwork.');
    assert.deepEqual(readFileSync(resolve(temporary, 'design/asset-map.json')), productionIndex, 'The dev checkout must retain its original index.');
    assert.equal(git(['rev-parse', 'refs/heads/dev']), baselineCommit, 'The dev branch must not advance during a draft submission.');
    assert.equal(git(['status', '--porcelain']), '', 'Only the private draft may change.');
}

try {
    for (const input of ['src', 'public', 'design', '.gitignore', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json']) {
        cpSync(resolve(ROOT, input), resolve(temporary, input), { recursive: true });
    }
    git(['init', '-b', 'dev']);
    git(['add', '--all']);
    git([...owner, 'commit', '-m', 'Create artwork studio test fixture']);
    git(['remote', 'add', 'origin', temporary]);
    baselineCommit = git(['rev-parse', 'HEAD']);

    studio = createStudioServer({
        root: temporary,
        reviewBuilder: async (name, options) => {
            reviewCalls++;
            await reviewGate;
            return buildGardenReview(name, options);
        },
        publisher: async (workspace, commit) => {
            publicationCalls++;
            const checked = containedTemporary(workspace);
            assert.equal(basename(checked), 'draft');
            assert.match(basename(dirname(checked)), /^garden-studio-/);
            assert.equal(resolve(checked, git(['rev-parse', '--git-common-dir'], checked)), resolve(temporary, '.git'));
            assert.match(git(['symbolic-ref', '--short', 'HEAD'], checked), /^art\/review-/);
            assert.equal(commit, git(['rev-parse', 'HEAD'], checked));
            assert.equal(git(['rev-parse', `${commit}^`], checked), baselineCommit);
            assert.deepEqual(blob(commit, asset.path, checked), synthetic, 'The submission must contain the exact uploaded bytes.');

            const changes = git(['diff', '--name-status', '--no-renames', `${commit}^`, commit, '--'], checked)
                .split('\n').map(line => { const [status, path] = line.split('\t'); return { status, path }; });
            assert.equal(changes.length, 3, 'A submission contains only the PNG, its index update, and its approval receipt.');
            const approved = validateArtworkChange({
                before: JSON.parse(blob(`${commit}^`, 'design/asset-map.json', checked)),
                after: JSON.parse(blob(commit, 'design/asset-map.json', checked)),
                manifest: JSON.parse(blob(`${commit}^`, 'design/figma-assets.json', checked)),
                changes,
                readBefore: path => blob(`${commit}^`, path, checked),
                readAfter: path => blob(commit, path, checked),
            });
            assert.equal(approved.length, 1);
            assert.equal(approved[0].asset, 'void-tile');
            assert.equal(approved[0].note, note);
            assert.equal(approved[0].baselineSha256, sha256(productionBytes));
            assert.equal(approved[0].candidateSha256, sha256(synthetic));
            const receipt = JSON.parse(blob(commit, approved[0].receiptPath, checked));
            assert.equal(receipt.provenance.kind, 'manual-export');
            for (const evidence of receipt.reviewFiles) {
                assert.equal(sha256(readFileSync(resolve(checked, '.design-staging/void-tile', evidence.path))), evidence.sha256);
            }
            assertUnchangedOrigins();
            return { target: 'dev', url: reviewUrl };
        },
    });
    await new Promise(done => studio.server.listen(0, '127.0.0.1', done));
    const port = studio.server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const token = studio.state().token;
    const send = (path, { method = 'POST', headers = {}, body = '{}' } = {}) => new Promise((done, reject) => {
        const configured = { Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'application/json', 'X-Review-Token': token, 'X-Review-Revision': String(studio.state().revision), ...headers };
        for (const [key, value] of Object.entries(configured)) if (value === null) delete configured[key];
        const req = request({ hostname: '127.0.0.1', port, path, method, headers: configured, agent: false }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => done({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
            response.on('error', reject);
        });
        req.on('error', error => reject(new Error(`${method} ${path}: ${error.message}`, { cause: error })));
        req.end(method === 'GET' ? undefined : body);
    });
    console.log('Studio integration: checking local request protections.');
    const selectBody = JSON.stringify({ asset: 'grass' });
    for (const headers of [{ 'X-Review-Token': null }, { 'X-Review-Token': 'invalid' }, { Origin: 'https://example.com' }, { 'X-Review-Revision': null }]) {
        assert.equal((await send('/api/select', { headers, body: selectBody })).status, 400);
    }
    assert.equal((await send('/api/state', { method: 'GET', headers: { Host: 'example.com' } })).status, 403);
    assert.equal((await send('/api/state', { method: 'GET', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await send('/api/main')).status, 404, 'Studio has no main-publication route.');
    for (const path of ['/.env', '/package.json', '/src/assets/void_tile.png', '/.git/config']) {
        assert.equal((await send(path, { method: 'GET' })).status, 404, `No filesystem route: ${path}`);
    }
    assert.equal(studio.state().selectedAsset, 'void-tile');
    assert.equal(studio.state().phase, 'idle');
    assert.equal(publicationCalls, 0);

    console.log('Studio integration: checking a delayed upload against changed selection.');
    const alternate = studio.state().assets.find(candidate => candidate.key !== 'void-tile');
    assert(alternate, 'The race fixture needs another mapped component.');
    const uploadStarted = new Promise(done => studio.server.once('request', incoming => { assert.equal(incoming.url, '/api/import'); done(); }));
    let pendingUpload;
    const uploadResponse = new Promise((done, reject) => {
        pendingUpload = request({ hostname: '127.0.0.1', port, path: '/api/import', method: 'POST', headers: {
            Host: `127.0.0.1:${port}`, Origin: base, 'Content-Type': 'image/png', 'Content-Length': productionBytes.length,
            'X-Review-Token': token, 'X-Review-Revision': String(studio.state().revision),
        } }, response => { response.resume(); response.on('end', () => done(response.statusCode)); });
        pendingUpload.on('error', error => reject(new Error(`Delayed upload: ${error.message}`, { cause: error })));
        pendingUpload.write(productionBytes.subarray(0, 45));
    });
    await uploadStarted;
    assert.equal((await send('/api/select', { body: JSON.stringify({ asset: alternate.key }) })).status, 200);
    pendingUpload.end(productionBytes.subarray(45));
    assert.equal(await uploadResponse, 400, 'A delayed upload must not be applied to a newly selected component.');
    assert.equal(studio.state().report, null);
    assert.equal(studio.state().phase, 'idle');
    assert.equal(studio.state().selectedAsset, alternate.key);
    assert.equal((await send('/api/select', { body: JSON.stringify({ asset: 'void-tile' }) })).status, 200);
    assert.equal(git(['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).length, 1);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const externalRequests = [];
    await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === base) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base);
    await page.getByRole('combobox').selectOption('void-tile');
    assert.equal(await page.getByRole('textbox', { name: /sha.?256|hash/i }).count(), 0, 'The review flow must not require a raw hash input.');
    synthetic = Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const drawing = canvas.getContext('2d');
        drawing.fillStyle = '#ec3b78'; drawing.fillRect(0, 0, 32, 32);
        drawing.fillStyle = '#37c999'; drawing.fillRect(0, 0, 16, 16); drawing.fillRect(16, 16, 16, 16);
        return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');

    const imported = page.waitForResponse(response => response.url() === `${base}/api/import` && response.request().method() === 'POST');
    await page.locator('input[type="file"]').setInputFiles({ name: 'native-review.png', mimeType: 'image/png', buffer: synthetic });
    assert.equal((await imported).status(), 202);
    await studio.waitForIdle();
    assert.equal(studio.state().error, null);
    assert.equal(studio.state().phase, 'staged');
    assert.equal(studio.state().report.candidateSha256, sha256(synthetic));
    const stagedRevision = studio.state().revision;
    assertUnchangedOrigins();

    const reviewRequest = page.waitForResponse(response => response.url() === `${base}/api/review` && response.request().method() === 'POST');
    await page.getByRole('button', { name: /preview.*garden/i }).click();
    assert.equal((await reviewRequest).status(), 202);
    assert.equal(studio.state().busy, true);
    await page.waitForFunction(() => ['asset-select', 'review-button', 'approve-button', 'submit-button'].every(id => document.getElementById(id).disabled));
    assert.equal((await send('/api/select', { body: selectBody })).status, 400, 'Selection cannot race an active review.');
    assert.equal((await send('/api/review')).status, 400, 'A second review cannot run concurrently.');
    assert.equal((await send('/api/submit')).status, 400, 'An active review cannot be submitted.');
    assert.equal(studio.state().selectedAsset, 'void-tile');
    releaseReview();
    console.log('Studio integration: rendering the actual current/candidate desktop and mobile gardens.');
    await studio.waitForIdle();
    assert.equal(studio.state().error, null);
    assert.equal(studio.state().phase, 'reviewed');
    assert.equal(reviewCalls, 1);
    assert.equal(studio.state().review.sourceExercised, true);
    assert(studio.state().review.comparisons.every(comparison => comparison.changedPixels > 0));
    assertUnchangedOrigins();

    const staleApproval = await send('/api/approve', { headers: { 'X-Review-Revision': String(stagedRevision) }, body: JSON.stringify({ note }) });
    assert.equal(staleApproval.status, 400, 'An older review window cannot approve a newer state.');
    assert.match(staleApproval.text, /changed in another window/i);
    assert.equal(studio.state().phase, 'reviewed');
    for (const [button, width, height] of [['desktop-view', 1280, 900], ['mobile-view', 390, 844]]) {
        await page.locator(`#${button}`).click();
        await page.waitForFunction(({ width, height }) => ['before-scene', 'after-scene', 'difference-image'].every(id => {
            const image = document.getElementById(id);
            return image.complete && image.naturalWidth === width && image.naturalHeight === height;
        }), { width, height });
        await page.locator('#show-difference').check();
        assert.equal(await page.locator('#difference-scene').isVisible(), true);
        await page.locator('#show-difference').uncheck();
    }
    if (process.env.DESIGN_STUDIO_SCREENSHOTS) {
        const screenshotDirectory = resolve(process.env.DESIGN_STUDIO_SCREENSHOTS);
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.locator('#desktop-view').click();
        await page.screenshot({ path: resolve(screenshotDirectory, 'studio-desktop.png'), fullPage: true });
        await page.locator('#mobile-view').click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: resolve(screenshotDirectory, 'studio-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 1000 });
    }

    await page.getByRole('textbox', { name: /note|rationale/i }).fill(note);
    const approved = page.waitForResponse(response => response.url() === `${base}/api/approve` && response.request().method() === 'POST');
    await page.getByRole('button', { name: /approve/i }).click();
    assert.equal((await approved).status(), 202);
    await studio.waitForIdle();
    assert.equal(studio.state().error, null);
    assert.equal(studio.state().phase, 'approved');
    assert.equal(publicationCalls, 0);
    assertUnchangedOrigins();

    const submitted = page.waitForResponse(response => response.url() === `${base}/api/submit` && response.request().method() === 'POST');
    await page.getByRole('button', { name: /submit.*dev/i }).click();
    assert.equal((await submitted).status(), 202);
    await studio.waitForIdle();
    assert.equal(studio.state().error, null);
    assert.equal(studio.state().phase, 'submitted');
    assert.equal(publicationCalls, 1);
    await page.locator(`a[href="${reviewUrl}"]`).waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
        const screenshots = [...document.querySelectorAll('img')].filter(image => image.src.includes('/review-files/'));
        return screenshots.length === 3 && screenshots.every(image => image.complete && image.naturalWidth > 0);
    });
    for (const [index, evidence] of studio.state().review.files.entries()) {
        if (!evidence.path.endsWith('.png')) continue;
        const response = await fetch(`${base}/review-files/${index}`);
        assert.equal(response.status, 200, 'Reviewed screenshots stay available after applying a draft.');
        assert.equal(sha256(Buffer.from(await response.arrayBuffer())), evidence.sha256);
    }
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/images/current.png`)).arrayBuffer()), productionBytes);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/images/candidate.png`)).arrayBuffer()), synthetic);
    assert.equal((await send('/api/submit')).status, 400, 'A submitted draft cannot be published twice.');
    assert.equal(publicationCalls, 1);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, [], 'The local desk must not contact an external service during the fixture.');
    assertUnchangedOrigins();
    console.log('Studio passed: native upload, real garden comparison, note-only approval, isolated exact-artwork commit, dev-only publication fixture, and request protections.');
} finally {
    releaseReview();
    await studio?.waitForIdle();
    await browser?.close();
    if (studio?.server.listening) await new Promise(done => studio.server.close(done));
    if (existsSync(resolve(temporary, '.git'))) {
        const worktrees = git(['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
        for (const worktree of worktrees) {
            if (resolve(worktree) === resolve(temporary)) continue;
            const checked = containedTemporary(worktree);
            const directory = containedTemporary(dirname(checked));
            assert.equal(basename(checked), 'draft');
            assert.match(basename(directory), /^garden-studio-/);
            assert.equal(resolve(checked, git(['rev-parse', '--git-common-dir'], checked)), resolve(temporary, '.git'));
            git(['worktree', 'remove', '--force', checked]);
            rmSync(directory, { recursive: true, force: true });
        }
    }
    rmSync(containedTemporary(temporary), { recursive: true, force: true });
}
