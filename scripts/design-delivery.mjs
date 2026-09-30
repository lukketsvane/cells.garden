#!/usr/bin/env node
// Deliver one reviewed artwork commit without merging unrelated development work.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = ['-c', 'user.name=tastefinger', '-c', 'user.email=41840333+lukketsvane@users.noreply.github.com'];
const MAP = 'design/asset-map.json';
const MANIFEST = 'design/figma-assets.json';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PNG = /^src\/assets\/[\w/.-]+\.png$/;
const RECEIPT = /^design\/changes\/[\w-]+-[a-f0-9]{64}-[a-f0-9]{64}\.json$/;
const VISUAL_PATHS = ['src', 'public', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'design/render-map.json', MANIFEST];
export const CHECKS = ['typecheck', 'typecheck:ext', 'typecheck:obsidian', 'lint', 'test:unit', 'test:design', 'build', 'test:design:preview', 'test:design:review', 'test:design:studio', 'test:web', 'test:ext', 'test:obsidian'];
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options });
const git = (root, args, options) => run('git', args, root, options);
const blob = (root, ref, path) => git(root, ['cat-file', 'blob', `${ref}:${path}`], { encoding: null });
const json = (root, ref, path) => JSON.parse(blob(root, ref, path).toString('utf8'));

export function parseDeliveryArgs(args) {
    const options = { target: undefined, commit: undefined, mode: 'plan' };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help') return { help: true };
        if (['--target', '--commit', '--prepared', '--review-sha256', '--note'].includes(arg)) {
            const key = arg === '--review-sha256' ? 'reviewSha256' : arg.slice(2);
            requireThat(options[key] === undefined && args[i + 1], `Supply ${arg} once with its value.`);
            options[key] = args[++i];
        } else if (arg === '--prepare' || arg === '--publish') {
            requireThat(options.mode === 'plan', 'Choose either --prepare or --publish.');
            options.mode = arg.slice(2);
        } else throw new Error(`Unknown option: ${arg}`);
    }
    if (options.prepared) {
        requireThat(options.mode === 'publish' && !options.target && !options.commit, 'Resume a prepared target review with --prepared <worktree> --publish.');
        requireThat(DIGEST.test(options.reviewSha256), 'Name the exact prepared --review-sha256 shown after preparation.');
        requireThat(typeof options.note === 'string' && options.note.trim().length >= 3 && options.note.length <= 1000, 'Supply --note with your target review decision (3–1000 characters).');
        return options;
    }
    requireThat(!options.reviewSha256 && !options.note, 'A review hash and note are used only with --prepared.');
    requireThat(['dev', 'main'].includes(options.target), 'Use --target dev or --target main.');
    requireThat(SHA.test(options.commit), 'Use --commit with the exact full 40-character commit SHA.');
    return options;
}

export function validateArtworkChange({ before, after, manifest, changes, readBefore, readAfter }) {
    requireThat(Array.isArray(before.assets) && Array.isArray(after.assets), 'Missing artwork index.');
    const assets = changes.filter(change => PNG.test(change.path) && !change.path.includes('..'));
    const receipts = changes.filter(change => RECEIPT.test(change.path));
    requireThat(assets.length > 0, 'The selected commit has no indexed PNG artwork changes.');
    requireThat(changes.every(change => change.path === MAP || assets.includes(change) || receipts.includes(change)),
        'An artwork delivery may contain only indexed PNGs, their approval receipts, and design/asset-map.json.');
    requireThat(changes.some(change => change.path === MAP && change.status === 'M'), 'The artwork index must be updated in the same commit.');
    requireThat(assets.every(change => change.status === 'M') && receipts.every(change => change.status === 'A'),
        'Artwork must modify existing PNGs and add new approval receipts; deletions, renames and receipt rewrites are rejected.');
    requireThat(receipts.length === assets.length, 'Every changed PNG needs exactly one new approval receipt.');
    requireThat(new Set(before.assets.map(asset => asset.path)).size === before.assets.length, 'Duplicate baseline artwork index entries.');
    requireThat(new Set(after.assets.map(asset => asset.path)).size === after.assets.length, 'Duplicate candidate artwork index entries.');
    const expected = structuredClone(before);
    if (after.capturedAt !== before.capturedAt) {
        requireThat(typeof after.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(after.capturedAt), 'Invalid artwork index capture date.');
        expected.capturedAt = after.capturedAt;
    }
    const approved = [];
    for (const change of assets) {
        const prior = before.assets.find(asset => asset.path === change.path);
        const next = after.assets.find(asset => asset.path === change.path);
        requireThat(prior?.format === 'png' && next, `PNG is not already indexed: ${change.path}`);
        const baselineSha256 = hash(readBefore(change.path));
        const candidateSha256 = hash(readAfter(change.path));
        requireThat(prior.sha256 === baselineSha256 && next.sha256 === candidateSha256, `Artwork/index digest mismatch: ${change.path}`);
        requireThat(baselineSha256 !== candidateSha256, `Artwork bytes did not change: ${change.path}`);
        const asset = Object.entries(manifest.assets).find(([, value]) => value.path === change.path)?.[0]
            ?? change.path.replace(/^src\/assets\//, '').replace(/\.png$/, '').replaceAll('/', '-');
        const matchingReceipts = receipts.filter(receipt => receipt.path.startsWith(`design/changes/${asset}-${candidateSha256}-`));
        requireThat(matchingReceipts.length === 1, `Missing or duplicate approval receipt: ${change.path}`);
        const receiptPath = matchingReceipts[0].path;
        const receipt = JSON.parse(readAfter(receiptPath).toString('utf8'));
        requireThat(receiptPath === `design/changes/${asset}-${candidateSha256}-${hash(JSON.stringify(receipt))}.json`,
            `Approval receipt filename does not match its contents: ${receiptPath}`);
        const mapping = manifest.assets[asset] ?? prior;
        requireThat(receipt.schema === 'reviewed-artwork-v1' && receipt.version === 1,
            `Unrecognized artwork approval: ${receiptPath}`);
        for (const [key, value] of Object.entries({ asset, path: change.path, fileKey: manifest.fileKey,
            sourceNodeId: mapping.sourceNodeId, exportNodeId: mapping.exportNodeId, baselineSha256, candidateSha256 })) {
            requireThat(value && receipt[key] === value, `Approval ${key} does not match the selected change: ${change.path}`);
        }
        requireThat(typeof receipt.note === 'string' && receipt.note.trim().length > 0 && Number.isFinite(Date.parse(receipt.approvedAt)),
            `Approval needs a review note and timestamp: ${change.path}`);
        requireThat(DIGEST.test(receipt.reviewSha256) && DIGEST.test(receipt.rendererSha256), `Missing review fingerprints: ${change.path}`);
        requireThat(['figma-mcp', 'manual-export', 'unspecified'].includes(receipt.provenance?.kind), `Unknown artwork provenance: ${change.path}`);
        requireThat(Array.isArray(receipt.reviewFiles) && receipt.reviewFiles.length > 0
            && receipt.reviewFiles.every(file => typeof file.path === 'string' && file.path.length > 0 && !file.path.includes('..')
                && !/^(?:[a-z]:|\/|\\)/i.test(file.path) && DIGEST.test(file.sha256)), `Invalid review evidence: ${change.path}`);
        Object.assign(expected.assets.find(entry => entry.path === change.path), {
            sha256: candidateSha256, status: 'unverified', figmaSha256: null, figmaImageSha1: null, evidence: 'approved-artwork-review',
        });
        approved.push({ asset, path: change.path, receiptPath, baselineSha256, candidateSha256, note: receipt.note });
    }
    requireThat(isDeepStrictEqual(expected, after), 'The commit changes unapproved artwork index data or source mappings.');
    return approved;
}

function changedPaths(root, parent, commit) {
    const fields = git(root, ['diff', '--name-status', '--no-renames', '-z', parent, commit, '--']).split('\0');
    const changes = [];
    for (let i = 0; i + 1 < fields.length; i += 2) changes.push({ status: fields[i], path: fields[i + 1] });
    return changes;
}

export function inspectDelivery(root, { target, commit }, { targetReview = false } = {}) {
    requireThat(['dev', 'main'].includes(target) && SHA.test(commit), 'A target branch and exact commit SHA are required.');
    requireThat(git(root, ['rev-parse', '--verify', `${commit}^{commit}`]).trim() === commit, 'Selected object is not the exact commit.');
    const parents = git(root, ['rev-list', '--parents', '-n', '1', commit]).trim().split(' ');
    requireThat(parents.length === 2, 'Select one ordinary artwork commit, not a merge or root commit.');
    const parent = parents[1];
    const targetRef = `refs/remotes/origin/${target}`;
    const targetSha = git(root, ['rev-parse', '--verify', targetRef]).trim();
    const changes = changedPaths(root, parent, commit);
    const approved = validateArtworkChange({ before: json(root, parent, MAP), after: json(root, commit, MAP), manifest: json(root, parent, MANIFEST), changes,
        readBefore: path => blob(root, parent, path), readAfter: path => blob(root, commit, path) });
    const sceneChanges = git(root, ['diff', '--name-only', parent, targetSha, '--', ...VISUAL_PATHS]).trim();
    for (const asset of approved) {
        const targetDigest = hash(blob(root, targetSha, asset.path));
        requireThat(targetDigest !== asset.candidateSha256, `Target already contains this artwork: ${asset.path}`);
        if (!targetReview) requireThat(targetDigest === asset.baselineSha256,
            `Target artwork changed since review: ${asset.path}. Run --prepare for a fresh target review.`);
    }
    if (!targetReview) requireThat(!sceneChanges, `The ${target} garden differs from the reviewed scene. Run --prepare for a fresh target review:\n${sceneChanges}`);
    let devSha;
    if (target === 'main') {
        devSha = git(root, ['rev-parse', '--verify', 'refs/remotes/origin/dev']).trim();
        const devMap = json(root, devSha, MAP);
        const devReceipts = git(root, ['ls-tree', '-r', '--name-only', devSha, '--', 'design/changes']).trim().split(/\r?\n/).filter(path => RECEIPT.test(path));
        for (const asset of approved) {
            requireThat(hash(blob(root, devSha, asset.path)) === asset.candidateSha256,
                `Promotion requires the exact approved artwork on origin/dev: ${asset.path}`);
            const entry = devMap.assets.find(item => item.path === asset.path);
            requireThat(entry?.sha256 === asset.candidateSha256, `Promotion requires the approved index digest on origin/dev: ${asset.path}`);
            const matching = devReceipts.filter(path => path.startsWith(`design/changes/${asset.asset}-${asset.candidateSha256}-`)).some(path => {
                const receipt = json(root, devSha, path);
                return receipt.schema === 'reviewed-artwork-v1' && receipt.version === 1 && receipt.asset === asset.asset && receipt.path === asset.path
                    && receipt.candidateSha256 === asset.candidateSha256 && DIGEST.test(receipt.baselineSha256) && receipt.baselineSha256 !== receipt.candidateSha256
                    && receipt.fileKey === devMap.fileKey && receipt.sourceNodeId === entry.sourceNodeId && receipt.exportNodeId === entry.exportNodeId
                    && DIGEST.test(receipt.reviewSha256) && DIGEST.test(receipt.rendererSha256) && typeof receipt.note === 'string' && receipt.note.trim().length >= 3
                    && Number.isFinite(Date.parse(receipt.approvedAt)) && Array.isArray(receipt.reviewFiles) && receipt.reviewFiles.length > 0
                    && receipt.reviewFiles.every(file => typeof file.path === 'string' && !file.path.includes('..') && DIGEST.test(file.sha256))
                    && path === `design/changes/${asset.asset}-${asset.candidateSha256}-${hash(JSON.stringify(receipt))}.json`;
            });
            requireThat(matching, `Promotion requires an unchanged, valid approval receipt for these exact bytes on origin/dev: ${asset.path}`);
        }
    }
    return { target, commit, parent, targetSha, devSha, approved, sceneChanges: sceneChanges ? sceneChanges.split(/\r?\n/) : [], changedPaths: changes.map(change => change.path), checks: CHECKS };
}

export function assertSuccessfulDevCI(runs, commit) {
    const matching = runs.filter(run => run.headSha === commit && run.headBranch === 'dev' && run.event === 'push')
        .sort((a, b) => (b.databaseId ?? b.id ?? 0) - (a.databaseId ?? a.id ?? 0));
    requireThat(matching.length > 0 && matching[0].status === 'completed' && matching[0].conclusion === 'success',
        'Promotion requires the latest CI run for this exact commit on dev to have completed successfully.');
    return matching[0];
}

export function comparePublishedArtwork(root, baseline, { paths: deliveryPaths } = {}) {
    const refs = git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/']).trim().split(/\r?\n/)
        .filter(ref => ref && !ref.endsWith('/HEAD') && !ref.endsWith('/original'));
    if (!refs.length) return { refs, warnings: [] };
    const commits = git(root, ['log', '--format=%H%x09%ct%x09%an%x09%ae', ...refs, '--', ...VISUAL_PATHS]).trim().split(/\r?\n/)
        .filter(line => /\t(?:scubcoral)\t|\tkr4vler@gmail\.com$/i.test(line)).map(line => line.split('\t'))
        .sort((a, b) => Number(b[1]) - Number(a[1]));
    const latest = new Map();
    for (const [commit] of commits) {
        const paths = git(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit, '--', ...VISUAL_PATHS]).trim().split(/\r?\n/).filter(Boolean);
        for (const path of paths) if (!latest.has(path)) latest.set(path, commit);
    }
    const receipts = git(root, ['ls-tree', '-r', '--name-only', baseline, '--', 'design/changes']).trim().split(/\r?\n/).filter(path => RECEIPT.test(path))
        .map(path => ({ path, receipt: json(root, baseline, path) })).filter(({ path, receipt }) => receipt.schema === 'reviewed-artwork-v1' && receipt.version === 1
            && DIGEST.test(receipt.baselineSha256) && DIGEST.test(receipt.candidateSha256)
            && path === `design/changes/${receipt.asset}-${receipt.candidateSha256}-${hash(JSON.stringify(receipt))}.json`);
    const conflicts = [];
    const warnings = [];
    for (const [path, commit] of latest) {
        try { git(root, ['merge-base', '--is-ancestor', commit, baseline]); continue; } catch { /* Compare reconciled bytes below. */ }
        if (!git(root, ['diff', '--name-only', baseline, commit, '--', path]).trim()) continue;
        if (PNG.test(path)) {
            const reachable = new Set([hash(blob(root, commit, path))]);
            for (let pass = 0; pass < receipts.length; pass++) {
                for (const { receipt } of receipts) if (receipt.path === path && reachable.has(receipt.baselineSha256)) reachable.add(receipt.candidateSha256);
            }
            if (reachable.has(hash(blob(root, baseline, path)))) continue;
        }
        const finding = { path, commit, message: 'Published artwork or styling differs from the current target.' };
        if (!deliveryPaths || deliveryPaths.includes(path)) conflicts.push(`${commit.slice(0, 12)}: ${path}`);
        else warnings.push(finding);
    }
    requireThat(conflicts.length === 0, `Published artwork or styling by Max needs reconciliation before delivery:\n${[...new Set(conflicts)].join('\n')}`);
    return { refs, warnings };
}

function repositoryName(root) {
    const url = git(root, ['remote', 'get-url', 'origin']).trim();
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
    requireThat(match, 'Delivery expects a GitHub origin remote.');
    return match[1];
}

function npmCli() {
    if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
    const candidates = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
    for (const entry of (process.env.PATH ?? '').split(delimiter)) {
        for (const name of ['npm', 'npm.cmd']) {
            const path = join(entry, name);
            if (existsSync(path)) {
                const actual = realpathSync(path);
                if (actual.endsWith('npm-cli.js')) candidates.push(actual);
                candidates.push(join(dirname(actual), 'node_modules/npm/bin/npm-cli.js'));
            }
        }
    }
    const found = candidates.find(path => existsSync(path));
    requireThat(found, 'Run this command through npm run design:deliver so the npm CLI can be located.');
    return found;
}

function remoteHeads(root) {
    return git(root, ['ls-remote', '--heads', 'origin']).trim().split(/\r?\n/).sort().join('\n');
}

function fetchedHeads(root) {
    return git(root, ['for-each-ref', '--format=%(objectname)%09%(refname)', 'refs/remotes/origin/']).trim().split(/\r?\n/)
        .filter(line => !line.endsWith('/HEAD')).map(line => line.replace('refs/remotes/origin/', 'refs/heads/')).sort().join('\n');
}

function checkDevCI(root, repository, plan) {
    if (plan.target !== 'main') return;
    const runs = JSON.parse(run('gh', ['run', 'list', '--repo', repository, '--workflow', 'ci.yml', '--branch', 'dev', '--commit', plan.devSha,
        '--event', 'push', '--limit', '100', '--json', 'databaseId,headSha,headBranch,event,status,conclusion'], root));
    assertSuccessfulDevCI(runs, plan.devSha);
}

function refreshPublishedBranches(root) {
    git(root, ['fetch', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
    const remoteSnapshot = remoteHeads(root);
    requireThat(fetchedHeads(root) === remoteSnapshot, 'Published branches advanced during fetch; rerun delivery.');
    return remoteSnapshot;
}

function reviewWorktree(root, plan) {
    const directory = mkdtempSync(join(tmpdir(), 'garden-artwork-'));
    const worktree = join(directory, 'review');
    const branch = `art/${plan.target}-${plan.commit.slice(0, 10)}-${randomUUID().slice(0, 6)}`;
    git(root, ['worktree', 'add', '-b', branch, worktree, plan.targetSha]);
    return { directory, worktree, branch };
}

function requireTargetTooling(root, targetSha) {
    const scripts = json(root, targetSha, 'package.json').scripts;
    requireThat(CHECKS.every(check => typeof scripts?.[check] === 'string'),
        'The target branch needs the design pipeline scripts installed before artwork delivery. Install tooling without changing its runtime or artwork first.');
    json(root, targetSha, MAP);
    json(root, targetSha, MANIFEST);
}

export function preparedReviewDigest(state) {
    return hash(JSON.stringify({ version: 1, target: state.target, targetSha: state.targetSha, commit: state.commit, reviews: state.reviews }));
}

async function prepareTargetReview(root, plan) {
    requireThat(plan.approved.length === 1, 'Prepare one artwork asset per commit for an independent target review.');
    const { worktree, branch } = reviewWorktree(root, plan);
    try {
        const { stageAsset } = await import('./design-assets.mjs');
        const { buildGardenReview } = await import('./design-review.mjs');
        const reviews = [];
        for (const asset of plan.approved) {
            const sourceReceipt = json(root, plan.commit, asset.receiptPath);
            const report = stageAsset(asset.asset, blob(root, plan.commit, asset.path), worktree, sourceReceipt.provenance);
            await buildGardenReview(asset.asset, { root: worktree });
            const reviewPath = join(worktree, '.design-staging', asset.asset, 'review.json');
            reviews.push({ asset: asset.asset, path: asset.path, baselineSha256: report.baselineSha256, candidateSha256: report.candidateSha256,
                reviewSha256: hash(readFileSync(reviewPath)) });
        }
        requireThat(!git(worktree, ['status', '--porcelain', '--untracked-files=no']).trim(), 'Preparing a target review changed tracked source files.');
        const state = { version: 1, target: plan.target, targetSha: plan.targetSha, commit: plan.commit, branch, reviews };
        mkdirSync(join(worktree, '.design-staging'), { recursive: true });
        writeFileSync(join(worktree, '.design-staging/delivery.json'), JSON.stringify(state, null, 2) + '\n');
        return { mode: 'prepare', ...state, worktree, reviewSha256: preparedReviewDigest(state), publishedArtwork: plan.publishedArtwork,
            message: 'Review the target garden before/after images. Source artwork is unchanged. Resume with --prepared <worktree> --publish --review-sha256 <this digest> --note <your decision>.' };
    } catch (error) {
        throw new Error(`${error.message}\nTarget review worktree retained at ${worktree}.`, { cause: error });
    }
}

function publishWorktree(root, plan, { worktree, branch, remoteSnapshot, guardBaseline = plan.parent }) {
    const npm = npmCli();
    const repository = repositoryName(root);
    let pushed = false;
    try {
        const staged = git(worktree, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean).sort();
        requireThat(isDeepStrictEqual(staged, [...plan.changedPaths].sort()), 'Delivery staged files outside the approved artwork change.');
        for (const asset of plan.approved) requireThat(hash(readFileSync(join(worktree, asset.path))) === asset.candidateSha256, `Delivery changed approved bytes: ${asset.path}`);
        run(process.execPath, [npm, 'ci', '--ignore-scripts'], worktree, { stdio: 'inherit' });
        run(process.execPath, [join(worktree, 'node_modules/playwright/cli.js'), 'install', 'chromium'], worktree, { stdio: 'inherit' });
        for (const check of CHECKS) run(process.execPath, [npm, 'run', check], worktree, { stdio: 'inherit' });
        // Builds may regenerate tracked release files. Never include those in this artwork commit.
        requireThat(!git(worktree, ['diff', '--name-only', '--', ...plan.changedPaths]).trim(), 'Checks modified approved delivery files.');
        requireThat(isDeepStrictEqual(git(worktree, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean).sort(), staged),
            'Checks changed the staged delivery file list.');
        git(worktree, [...OWNER, 'commit', '-m', `Update reviewed artwork for ${plan.target}`]);
        const deliveryCommit = git(worktree, ['rev-parse', 'HEAD']).trim();
        validateArtworkChange({ before: json(worktree, plan.targetSha, MAP), after: json(worktree, deliveryCommit, MAP),
            manifest: json(worktree, plan.targetSha, MANIFEST), changes: changedPaths(worktree, plan.targetSha, deliveryCommit),
            readBefore: path => blob(worktree, plan.targetSha, path), readAfter: path => blob(worktree, deliveryCommit, path) });
        const result = { ...plan, mode: 'publish', branch, worktree, deliveryCommit };
        requireThat(remoteHeads(root) === remoteSnapshot, 'Published branches advanced while checks ran. The prepared worktree is retained; rerun from the latest target.');
        comparePublishedArtwork(root, guardBaseline, { paths: plan.approved.map(asset => asset.path) });
        checkDevCI(root, repository, plan);
        git(worktree, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
        pushed = true;
        const bodyPath = join(worktree, '.design-staging/pull-request.md');
        mkdirSync(dirname(bodyPath), { recursive: true });
        const body = `Apply only the reviewed artwork from commit ${plan.commit} to ${plan.target}.\n\n`
            + plan.approved.map(asset => `- ${asset.path}: ${asset.note}\n  Approved SHA-256: ${asset.candidateSha256}`).join('\n')
            + `\n\nValidation: ${CHECKS.map(check => `npm run ${check}`).join(', ')}.\n\nReviewed artwork was applied to ${plan.targetSha}; unrelated development commits are excluded.\n`;
        writeFileSync(bodyPath, body);
        result.url = run('gh', ['pr', 'create', '--repo', repository, '--base', plan.target, '--head', branch,
            '--title', `Update reviewed artwork on ${plan.target}`, '--body-file', bodyPath], worktree).trim();
        return result;
    } catch (error) {
        throw new Error(`${error.message}\nDelivery stopped. Review worktree retained at ${worktree} on ${branch}.`
            + (pushed ? '\nThe review branch was pushed; check for an existing PR before retrying publication.' : ''), { cause: error });
    }
}

async function resumeTargetReview(root, options) {
    const worktree = realpathSync(resolve(options.prepared));
    const commonDirectory = cwd => realpathSync(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim()));
    requireThat(worktree !== realpathSync(root) && commonDirectory(worktree) === commonDirectory(root), 'Prepared review must be an isolated worktree of this repository.');
    const state = JSON.parse(readFileSync(join(worktree, '.design-staging/delivery.json'), 'utf8'));
    requireThat(state.version === 1 && state.reviews?.length === 1 && preparedReviewDigest(state) === options.reviewSha256,
        'Prepared target review changed or the exact --review-sha256 does not match.');
    requireThat(/^art\/(?:dev|main)-[a-f0-9]{10}-[a-f0-9]{6}$/.test(state.branch)
        && git(worktree, ['branch', '--show-current']).trim() === state.branch && git(worktree, ['rev-parse', 'HEAD']).trim() === state.targetSha,
    'Prepared worktree branch or commit changed. Prepare a fresh target review.');
    requireThat(!git(worktree, ['status', '--porcelain', '--untracked-files=no']).trim(), 'Prepared target has tracked changes; prepare a fresh review.');
    const remoteSnapshot = refreshPublishedBranches(root);
    const plan = inspectDelivery(root, { target: state.target, commit: state.commit }, { targetReview: true });
    requireThat(plan.targetSha === state.targetSha, 'Target branch advanced since its review. Prepare a fresh target review.');
    plan.publishedArtwork = comparePublishedArtwork(root, plan.targetSha, { paths: plan.approved.map(asset => asset.path) });
    checkDevCI(root, repositoryName(root), plan);
    const { approveAsset, applyAsset } = await import('./design-assets.mjs');
    const { validateGardenReview } = await import('./design-review.mjs');
    const paths = [MAP];
    for (const reviewed of state.reviews) {
        const selected = plan.approved.find(asset => asset.asset === reviewed.asset);
        requireThat(selected?.path === reviewed.path && selected.candidateSha256 === reviewed.candidateSha256,
            'The prepared candidate no longer matches the selected artwork commit.');
        const review = validateGardenReview(reviewed.asset, { root: worktree });
        requireThat(review.baselineSha256 === reviewed.baselineSha256 && review.candidateSha256 === reviewed.candidateSha256
            && hash(readFileSync(join(worktree, '.design-staging', reviewed.asset, 'review.json'))) === reviewed.reviewSha256,
        'Target review evidence changed. Prepare and inspect it again.');
        const approval = approveAsset(reviewed.asset, { sha256: reviewed.candidateSha256, note: options.note }, worktree);
        applyAsset(reviewed.asset, worktree);
        paths.push(reviewed.path, `design/changes/${reviewed.asset}-${reviewed.candidateSha256}-${hash(JSON.stringify(approval))}.json`);
    }
    git(worktree, ['add', '--', ...paths]);
    const changes = paths.map(path => ({ path, status: path.startsWith('design/changes/') ? 'A' : 'M' }));
    const approved = validateArtworkChange({ before: json(worktree, state.targetSha, MAP), after: JSON.parse(readFileSync(join(worktree, MAP), 'utf8')),
        manifest: json(worktree, state.targetSha, MANIFEST), changes, readBefore: path => blob(worktree, state.targetSha, path), readAfter: path => readFileSync(join(worktree, path)) });
    return publishWorktree(root, { ...plan, approved, changedPaths: paths }, { worktree, branch: state.branch, remoteSnapshot, guardBaseline: plan.targetSha });
}

export function executeDelivery(root, options) {
    if (options.prepared) return resumeTargetReview(root, options);
    if (options.mode === 'plan') return { ...inspectDelivery(root, options), mode: 'plan', message: 'Local plan only; remote freshness and dev CI are checked during preparation or publication.' };
    requireThat(['prepare', 'publish'].includes(options.mode), 'Unknown delivery mode.');
    const remoteSnapshot = refreshPublishedBranches(root);
    const plan = inspectDelivery(root, options, { targetReview: options.mode === 'prepare' });
    requireTargetTooling(root, plan.targetSha);
    plan.publishedArtwork = comparePublishedArtwork(root, options.mode === 'prepare' ? plan.targetSha : plan.parent, { paths: plan.approved.map(asset => asset.path) });
    checkDevCI(root, repositoryName(root), plan);
    if (options.mode === 'prepare') return prepareTargetReview(root, plan);
    const checkout = reviewWorktree(root, plan);
    try { git(checkout.worktree, [...OWNER, 'cherry-pick', '--no-commit', plan.commit]); }
    catch (error) { throw new Error(`${error.message}\nConflicting review worktree retained at ${checkout.worktree}.`, { cause: error }); }
    return publishWorktree(root, plan, { ...checkout, remoteSnapshot });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const options = parseDeliveryArgs(process.argv.slice(2));
        if (options.help) console.log('Usage: npm run design:deliver -- --target dev|main --commit <full SHA> [--prepare|--publish]\nResume: npm run design:deliver -- --prepared <worktree> --publish --review-sha256 <digest> --note <decision>\nDefault: inspect a local plan. --prepare: build before/after garden evidence on an isolated target checkout, without applying artwork. --publish: run checks, push only reviewed artwork and open a PR. No command merges a PR.');
        else console.log(JSON.stringify(await executeDelivery(ROOT, options), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
