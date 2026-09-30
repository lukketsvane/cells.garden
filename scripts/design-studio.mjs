#!/usr/bin/env node
// Local product-team review desk. Every draft and submission targets dev only.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, manifest, coverage, assetKey, assetByName, stageAsset, pullAsset, approveAsset, applyAsset, stagedAsset, sha256 } from './design-assets.mjs';
import { buildGardenReview, validateGardenReview } from './design-review.mjs';

const OWNER = ['-c', 'user.name=tastefinger', '-c', 'user.email=41840333+lukketsvane@users.noreply.github.com'];
const requireThat = (value, message) => { if (!value) throw new Error(message); };
const json = (response, value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };

function run(command, args, cwd, progress = () => {}) {
    return new Promise((done, reject) => {
        const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', tail = '';
        child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) output = output.slice(-1024 * 1024); });
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
            tail = (tail + chunk).slice(-12000);
            const last = String(chunk).trim().split(/\r?\n/).filter(Boolean).at(-1);
            if (last) progress(last.slice(0, 180));
        });
        child.on('error', reject);
        child.on('close', code => code === 0 ? done(output.trim()) : reject(new Error(tail.trim() || `${command} failed (${code}).`)));
    });
}

async function publishDev(root, commit, progress) {
    const output = await run(process.execPath, [resolve(ROOT, 'scripts/design-studio-worker.mjs'), root, commit], ROOT, progress);
    const result = output.split(/\r?\n/).findLast(line => line.startsWith('ARTWORK_RESULT '));
    requireThat(result, 'The review request result was not returned. The prepared worktree is retained; inspect the remote before retrying.');
    return JSON.parse(result.slice('ARTWORK_RESULT '.length));
}

async function readBody(request, limit) {
    const chunks = []; let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        requireThat(length <= limit, 'The uploaded file is too large. Use a native PNG under 1 MB.');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

export function createStudioServer({ root = ROOT, reviewBuilder = buildGardenReview, publisher = publishDev } = {}) {
    const token = randomBytes(32).toString('hex');
    const assets = coverage.assets.filter(asset => asset.format === 'png' && asset.sourceNodeId && asset.exportNodeId).map(asset => ({
        key: assetKey(asset.path), label: asset.path.replace(/^src\/assets\//, '').replaceAll('_', ' '), path: asset.path,
        width: asset.width, height: asset.height,
        figmaUrl: `https://www.figma.com/design/${manifest.fileKey}/cells.garden?node-id=${asset.sourceNodeId.replace(':', '-')}`,
    }));
    let selectedAsset = 'void-tile';
    let revision = 0;
    let workspace = null, job = null, preparedCommit = null, submissionAttempted = false;
    let reviewImages = new Map();
    let phase = 'idle', jobLabel = '', error = null, message = 'Choose artwork to review. Nothing changes until you approve it.', report = null, review = null, pullRequestUrl = null;

    const progress = label => { jobLabel = label; };
    const git = (args, cwd = root) => run('git', args, cwd, progress);
    const state = () => ({ token, revision, assets, selectedAsset, phase, busy: !!job, jobLabel, error, message, report, review, pullRequestUrl });
    async function draft() {
        if (workspace) return workspace;
        progress('Preparing a private draft from dev…');
        await git(['fetch', 'origin', '+refs/heads/dev:refs/remotes/origin/dev']);
        const directory = mkdtempSync(resolve(tmpdir(), 'garden-studio-'));
        const path = resolve(directory, 'draft');
        const branch = `art/review-${randomBytes(6).toString('hex')}`;
        await git(['worktree', 'add', '-b', branch, path, 'refs/remotes/origin/dev']);
        workspace = path;
        requireThat(existsSync(resolve(path, 'design/asset-map.json')), 'Dev needs the artwork-review tooling update first. No artwork was changed.');
        return path;
    }
    function start(label, operation) {
        requireThat(!job, 'A review operation is already running.');
        error = null; jobLabel = label; revision++;
        job = Promise.resolve().then(operation).catch(cause => { error = cause.message; message = 'Stopped safely. Your artwork draft is retained.'; })
            .finally(() => { job = null; jobLabel = ''; revision++; });
    }
    function resetEvidence() { report = null; review = null; preparedCommit = null; submissionAttempted = false; reviewImages = new Map(); pullRequestUrl = null; phase = 'idle'; }

    const server = createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        const port = server.address()?.port;
        const host = request.headers.host;
        if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host) || request.headers['sec-fetch-site'] === 'cross-site') {
            json(response, { error: 'Use the local artwork-review address.' }, 403); return;
        }
        try {
            const url = new URL(request.url, `http://${host}`);
            requireThat(!url.search, 'Unexpected request parameters.');
            if (request.method === 'GET') {
                if (url.pathname === '/api/state') { json(response, state()); return; }
                const staticFiles = { '/': ['index.html', 'text/html'], '/studio.js': ['studio.js', 'text/javascript'], '/studio.css': ['studio.css', 'text/css'] };
                const staticFile = staticFiles[url.pathname];
                if (staticFile) { response.writeHead(200, { 'Content-Type': staticFile[1] }); response.end(readFileSync(new URL(`./design-studio/${staticFile[0]}`, import.meta.url))); return; }
                const asset = assetByName(selectedAsset);
                if (url.pathname === '/images/current.png') {
                    const path = preparedCommit ? resolve(workspace, '.design-staging', selectedAsset, 'applied-baseline.png') : resolve(workspace ?? root, asset.path);
                    response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(readFileSync(path)); return;
                }
                if (url.pathname === '/images/candidate.png' && report && workspace) {
                    const bytes = preparedCommit ? readFileSync(resolve(workspace, '.design-staging', selectedAsset, 'candidate.png')) : stagedAsset(selectedAsset, workspace).bytes;
                    requireThat(sha256(bytes) === report.candidateSha256, 'The candidate changed. Start a new review.');
                    response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(bytes); return;
                }
                const index = /^\/review-files\/(\d+)$/.exec(url.pathname)?.[1];
                if (index !== undefined && review && workspace) {
                    const bytes = reviewImages.get(Number(index));
                    requireThat(bytes, 'Unknown review image.');
                    response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(bytes); return;
                }
                json(response, { error: 'Not found.' }, 404); return;
            }
            requireThat(request.method === 'POST', 'Unsupported method.');
            requireThat(request.headers.origin === `http://${host}` && request.headers['x-review-token'] === token, 'This action must come from this local review window.');
            const expectedRevision = request.headers['x-review-revision'];
            requireThat(expectedRevision === String(revision), 'This draft changed in another window. Refresh and inspect the current review before continuing.');
            requireThat(!job, 'An operation is already running.');
            requireThat(phase !== 'submitted' || url.pathname === '/api/select', 'This draft was already submitted. Choose artwork to start another draft.');
            const imported = url.pathname === '/api/import';
            requireThat((request.headers['content-type'] ?? '').split(';')[0] === (imported ? 'image/png' : 'application/json'), 'Unexpected content type.');
            const body = await readBody(request, imported ? 1024 * 1024 : 4096);
            requireThat(!job, 'An operation is already running.');
            requireThat(expectedRevision === String(revision), 'The selected draft changed while this request was loading. Review it again.');
            const data = imported ? null : JSON.parse(body.toString('utf8') || '{}');
            if (url.pathname === '/api/select') {
                requireThat(assets.some(asset => asset.key === data.asset), 'Choose an available artwork component.');
                selectedAsset = data.asset; workspace = null; resetEvidence(); error = null; revision++;
                message = 'Artwork selected. Get the current source from Figma or import its native PNG.';
                json(response, state()); return;
            }
            if (url.pathname === '/api/pull' || imported) {
                requireThat(!preparedCommit, 'This draft already has a submission commit. Start another draft before changing its artwork.');
                start(imported ? 'Importing native artwork…' : 'Getting artwork from Figma…', async () => {
                    const path = await draft();
                    report = imported ? stageAsset(selectedAsset, body, path, { kind: 'manual-export' }) : await pullAsset(selectedAsset, { root: path });
                    review = null; reviewImages = new Map(); phase = 'staged'; message = report.identical ? 'This artwork matches dev. You can still inspect it in the garden.' : 'New artwork is staged. Dev and production are unchanged.';
                });
            } else if (url.pathname === '/api/review') {
                requireThat(workspace && report && !preparedCommit, 'Get or import artwork first.');
                start('Building your garden comparison…', async () => {
                    review = await reviewBuilder(selectedAsset, { root: workspace });
                    validateGardenReview(selectedAsset, { root: workspace });
                    reviewImages = new Map(review.files.flatMap((file, index) => file.path.endsWith('.png') ? [[index, readFileSync(resolve(workspace, '.design-staging', selectedAsset, file.path))]] : []));
                    phase = 'reviewed'; message = review.sourceExercised ? 'Compare the current and proposed garden below.' : 'This component is not visible in the review fixture. Submission is unavailable.';
                });
            } else if (url.pathname === '/api/approve') {
                requireThat(phase === 'reviewed' && report && !report.identical, 'Preview a changed candidate in the garden before approving.');
                start('Saving your approval…', async () => {
                    approveAsset(selectedAsset, { sha256: report.candidateSha256, note: data.note }, workspace);
                    phase = 'approved'; message = 'Approved for this exact draft. Submit to open a checked review request for dev.';
                });
            } else if (url.pathname === '/api/submit') {
                requireThat(phase === 'approved' && workspace, 'Approve the artwork comparison before submitting.');
                requireThat(!submissionAttempted, 'A submission was already attempted. Check GitHub before creating another request; the draft is retained.');
                start('Checking your dev review request…', async () => {
                    if (!preparedCommit) {
                        applyAsset(selectedAsset, workspace);
                        const approval = JSON.parse(readFileSync(resolve(workspace, '.design-staging', selectedAsset, 'approval.json'), 'utf8'));
                        const receipt = `design/changes/${selectedAsset}-${approval.candidateSha256}-${sha256(Buffer.from(JSON.stringify(approval)))}.json`;
                        await git(['add', '--', assetByName(selectedAsset).path, 'design/asset-map.json', receipt], workspace);
                        await git([...OWNER, 'commit', '-m', 'Update reviewed artwork for development'], workspace);
                        preparedCommit = await git(['rev-parse', 'HEAD'], workspace);
                    }
                    submissionAttempted = true;
                    const result = await publisher(workspace, preparedCommit, progress);
                    requireThat(result.target === 'dev' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(result.url ?? ''), 'The dev review request could not be verified. Check the remote before retrying.');
                    pullRequestUrl = result.url; phase = 'submitted'; message = 'Your dev review request is ready. Nothing was merged or sent to main.';
                });
            } else { json(response, { error: 'Not found.' }, 404); return; }
            json(response, state(), 202);
        } catch (cause) { json(response, { error: cause.message }, 400); }
    });
    return { server, state, waitForIdle: async () => { while (job) await job; } };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.DESIGN_STUDIO_PORT || 5190);
    requireThat(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid review port.');
    const { server } = createStudioServer();
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Artwork review: http://127.0.0.1:${server.address().port}/\nOnly isolated dev drafts can be submitted. Keep this window open while reviewing.`));
}
