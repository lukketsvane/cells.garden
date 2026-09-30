import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify, isDeepStrictEqual } from 'node:util';
import { ROOT, coverage, manifest, sha256, validatePng } from './design-assets.mjs';

const execute = promisify(execFile);
const MAP = 'design/asset-map.json';
const OWNER = ['-c', 'user.name=tastefinger', '-c', 'user.email=41840333+lukketsvane@users.noreply.github.com'];
const FIELDS = ['sha256', 'status', 'figmaSha256', 'figmaImageSha1', 'evidence'];
const mapped = new Map([...coverage.assets.filter(asset => asset.format === 'png' && asset.sourceNodeId && asset.exportNodeId), ...Object.values(manifest.assets)].map(asset => [asset.path, asset]));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const fixed = entry => Object.fromEntries(Object.entries(entry).filter(([key]) => !FIELDS.includes(key)));

export function createDesignPublisher({ root = ROOT, delayMs = 15000, retryMs = 60000, validate, allowTestRemote = false } = {}) {
    const directory = resolve(root, '.design-staging/figma-live');
    const pendingPath = resolve(directory, 'pending.json');
    const pending = new Map();
    let revision = 0, timer, active, closed = false, installed = false, lastError, lastLogged, lastCommit, saving = Promise.resolve();
    let phase = 'idle', retrying = false;
    const run = (command, args, cwd = root, env = {}, options = {}) => execute(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`, GIT_TERMINAL_PROMPT: '0', ...env }, ...options });
    const git = async (args, cwd = root, env) => (await run('git', args, cwd, env)).stdout.trim();
    const blob = async (ref, path) => (await run('git', ['cat-file', 'blob', `${ref}:${path}`], root, { })).stdout;
    const readIndex = () => JSON.parse(readFileSync(resolve(root, MAP), 'utf8'));
    const checkRecord = record => {
        const asset = mapped.get(record.path);
        requireThat(asset && record.entry?.path === record.path && record.entry.format === 'png'
            && record.entry.width === asset.width && record.entry.height === asset.height
            && record.entry.sourceNodeId === asset.sourceNodeId && record.entry.exportNodeId === asset.exportNodeId,
        `Publish only mapped native PNG artwork: ${record.path}`);
        const bytes = Buffer.from(record.bytes, 'base64');
        validatePng(bytes, asset);
        requireThat(sha256(bytes) === record.entry.sha256, `Artwork/index digest mismatch: ${record.path}`);
        return bytes;
    };
    const move = async (source, target) => {
        for (let attempt = 0; ; attempt++) {
            try { await rename(source, target); return; }
            catch (error) { if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 10) throw error; await sleep(50); }
        }
    };
    const persist = () => {
        const bytes = JSON.stringify({ items: [...pending.values()] }) + '\n';
        saving = saving.catch(() => {}).then(async () => {
            mkdirSync(directory, { recursive: true });
            const temporary = `${pendingPath}.${randomUUID()}.tmp`;
            try { writeFileSync(temporary, bytes, { mode: 0o600 }); await move(temporary, pendingPath); }
            finally { if (existsSync(temporary)) unlinkSync(temporary); }
        });
        return saving;
    };
    if (existsSync(pendingPath)) {
        const saved = JSON.parse(readFileSync(pendingPath, 'utf8'));
        requireThat(Array.isArray(saved.items) && saved.items.length <= mapped.size, 'Invalid pending artwork publication.');
        for (const record of saved.items) {
            checkRecord(record);
            requireThat(!pending.has(record.path), 'Duplicate pending artwork publication.');
            pending.set(record.path, record);
        }
    }
    const checkRemote = async () => {
        for (const args of [['remote', 'get-url', '--all', 'origin'], ['remote', 'get-url', '--push', '--all', 'origin']]) {
            const urls = (await git(args)).split(/\r?\n/);
            requireThat(urls.length === 1 && (/^(?:https:\/\/github\.com\/|git@github\.com:)lukketsvane\/cells\.garden(?:\.git)?$/.test(urls[0])
                || (allowTestRemote && isAbsolute(urls[0]) && await git(['--git-dir', urls[0], 'rev-parse', '--is-bare-repository']) === 'true')),
            'Artwork publication requires the cells.garden origin repository.');
        }
    };
    const remoteHead = async () => (await git(['ls-remote', 'origin', 'refs/heads/dev'])).split(/\s/)[0];
    const guard = async (base, batch, version) => {
        if (closed || revision !== version) throw Object.assign(new Error('Artwork changed during publication checks.'), { stale: true });
        requireThat(await git(['branch', '--show-current']) === 'dev' && await git(['rev-parse', 'HEAD']) === base, 'The local dev branch advanced during artwork publication.');
        requireThat(await remoteHead() === base, 'origin/dev advanced during artwork publication.');
        requireThat(!(await git(['diff', '--cached', '--name-only', '-z', '--', MAP, ...batch.map(record => record.path)])), 'Unstage mapped artwork and its index before automatic publication.');
        const index = readIndex();
        for (const record of batch) requireThat(sha256(readFileSync(resolve(root, record.path))) === record.entry.sha256
            && isDeepStrictEqual(index.assets.find(entry => entry.path === record.path), record.entry), `Artwork changed outside the live import: ${record.path}`);
        if (closed || revision !== version) throw Object.assign(new Error('Artwork changed during publication checks.'), { stale: true });
    };
    const defaultValidate = async worktree => {
        const npm = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
        requireThat(existsSync(npm), 'Start the live artwork server through npm run dev:design.');
        await run(process.execPath, [npm, 'ci', '--ignore-scripts'], worktree);
        if (!installed) {
            await run(process.execPath, [resolve(worktree, 'node_modules/playwright/cli.js'), 'install', 'chromium'], worktree);
            installed = true;
        }
        const listener = createServer();
        await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
        const port = listener.address().port;
        await new Promise(done => listener.close(done));
        for (const check of ['typecheck', 'lint', 'test:design', 'build', 'test:web']) {
            try { await run(process.execPath, [npm, 'run', check], worktree, { TEST_WEB_PORT: String(port) }); }
            catch (error) { error.message += `\n${error.stdout || ''}`; throw error; }
        }
    };
    const publish = async () => {
        const version = revision;
        await checkRemote();
        requireThat(await git(['branch', '--show-current']) === 'dev', 'Automatic artwork publication runs only on dev.');
        const base = await git(['rev-parse', 'HEAD']);
        requireThat(await git(['rev-parse', 'refs/remotes/origin/dev']) === base && await remoteHead() === base, 'Synchronize the dev branch before automatic artwork publication.');
        const indexBytes = await blob(base, MAP);
        const index = JSON.parse(indexBytes);
        let updatedIndex = indexBytes;
        const batch = [];
        for (const record of [...pending.values()]) {
            const bytes = checkRecord(record);
            const prior = index.assets.find(entry => entry.path === record.path);
            requireThat(prior && isDeepStrictEqual(fixed(prior), fixed(record.entry)), `Artwork mapping changed outside the live import: ${record.path}`);
            const original = (await run('git', ['cat-file', 'blob', `${base}:${record.path}`], root, {}, { encoding: null })).stdout;
            const originalSha256 = sha256(original);
            requireThat(prior.sha256 === originalSha256, `Committed artwork/index digest mismatch: ${record.path}`);
            if (originalSha256 === record.entry.sha256) {
                if (pending.get(record.path) === record) pending.delete(record.path);
                continue;
            }
            batch.push(record);
            const priorEntry = JSON.stringify(prior);
            Object.assign(prior, Object.fromEntries(FIELDS.map(field => [field, record.entry[field]])));
            updatedIndex = updatedIndex.replace(priorEntry, JSON.stringify(prior));
        }
        await persist();
        if (!batch.length) return;
        await guard(base, batch, version);
        const worktree = resolve(directory, `publish-${randomUUID()}`);
        let added = false, indexLock;
        try {
            await git(['worktree', 'add', '--detach', worktree, base]);
            added = true;
            for (const record of batch) writeFileSync(resolve(worktree, record.path), checkRecord(record));
            writeFileSync(resolve(worktree, MAP), JSON.stringify(JSON.parse(updatedIndex)) === JSON.stringify(index) ? updatedIndex : JSON.stringify(index, null, 2) + '\n');
            const paths = [MAP, ...batch.map(record => record.path)];
            await git(['add', '--', ...paths], worktree);
            const tree = await git(['write-tree'], worktree);
            phase = 'validating';
            await (validate || defaultValidate)(worktree);
            await guard(base, batch, version);
            requireThat(await git(['write-tree'], worktree) === tree && !(await git(['diff', '--name-only', '--', ...paths], worktree)), 'Checks modified the captured artwork snapshot.');
            await git([...OWNER, 'commit', '-m', 'Update live Figma artwork'], worktree);
            const commit = await git(['rev-parse', 'HEAD'], worktree);
            requireThat(await git(['rev-parse', 'HEAD^{tree}'], worktree) === tree, 'The artwork commit differs from its tested snapshot.');
            const indexPath = resolve(root, await git(['rev-parse', '--git-path', 'index']));
            const candidateLock = `${indexPath}.lock`;
            const descriptor = openSync(candidateLock, 'wx');
            indexLock = candidateLock;
            try { writeFileSync(descriptor, readFileSync(indexPath)); } finally { closeSync(descriptor); }
            await git(['reset', '--quiet', commit, '--', ...paths], root, { GIT_INDEX_FILE: indexLock });
            await guard(base, batch, version);
            phase = 'publishing';
            try { await git(['push', 'origin', `${commit}:refs/heads/dev`]); }
            catch (error) { if (await remoteHead() !== commit) throw error; }
            await git(['update-ref', 'refs/heads/dev', commit, base]);
            await move(indexLock, indexPath);
            indexLock = undefined;
            lastCommit = commit;
            for (const record of batch) if (pending.get(record.path) === record) pending.delete(record.path);
            await persist();
            console.log(`Figma artwork published to dev: ${commit.slice(0, 12)}`);
        } finally {
            if (indexLock && existsSync(indexLock)) unlinkSync(indexLock);
            if (added) {
                requireThat(dirname(resolve(worktree)) === directory, 'The publication worktree must remain inside its ignored directory.');
                await git(['worktree', 'remove', '--force', worktree]);
            }
        }
    };
    const schedule = (milliseconds, retry = false) => {
        clearTimeout(timer);
        retrying = retry;
        phase = retry ? 'error' : 'queued';
        timer = setTimeout(() => { timer = undefined; void start(); }, milliseconds);
        timer.unref();
    };
    const start = () => {
        if (active || closed || !pending.size) return active;
        const version = revision;
        active = publish().then(() => { lastError = undefined; lastLogged = undefined; }).catch(error => {
            if (error.stale) { lastError = undefined; return; }
            lastError = error;
            if (lastLogged !== error.message) console.error(`Figma artwork publication retained: ${error.message}`);
            lastLogged = error.message;
        }).finally(() => {
            active = undefined;
            if (!closed && pending.size && (!lastError || revision !== version)) schedule(delayMs);
            else if (!closed && pending.size && lastError) schedule(retryMs, true);
            else phase = closed ? 'closed' : lastError ? 'error' : 'idle';
        });
        return active;
    };
    if (pending.size) schedule(delayMs);
    return {
        async enqueue(changes) {
            requireThat(!closed, 'The artwork publisher is closed.');
            if (!changes.length) return;
            const index = readIndex();
            const records = [...new Set(changes)].map(path => {
                requireThat(mapped.has(path), `Publish only mapped native PNG artwork: ${path}`);
                const record = { path, entry: structuredClone(index.assets.find(entry => entry.path === path)), bytes: readFileSync(resolve(root, path)).toString('base64') };
                checkRecord(record);
                return record;
            });
            for (const record of records) pending.set(record.path, record);
            revision++;
            await persist();
            lastError = undefined;
            if (!active && !closed) schedule(delayMs);
        },
        async waitForIdle() {
            while (active || (timer && !retrying)) {
                if (active) await active;
                else { clearTimeout(timer); timer = undefined; await start(); }
            }
            if (lastError) throw lastError;
            return { phase, pending: pending.size, lastCommit };
        },
        async close() { closed = true; clearTimeout(timer); timer = undefined; if (active) await active; await saving; phase = 'closed'; },
        get status() { return { phase, pending: pending.size, lastCommit, error: lastError?.message }; },
    };
}
