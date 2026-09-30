import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { rename as renameFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { ROOT, sha256 } from './design-assets.mjs';
import { readDesignExport } from './design-export.mjs';
import { createDesignBridge } from './design-bridge.mjs';

let syncing = Promise.resolve();

export function syncDesignExport(path, options = {}) {
    const operation = syncing.catch(() => {}).then(() => syncExport(path, options));
    syncing = operation;
    return operation;
}

async function syncExport(path, { root = ROOT, asset = 'gnome', rename = renameFile } = {}) {
    const exports = readDesignExport(path, asset);
    const indexPath = resolve(root, 'design/asset-map.json');
    const indexBytes = readFileSync(indexPath);
    const index = JSON.parse(indexBytes);
    let updatedIndex = indexBytes.toString('utf8');
    const changes = exports.filter(item => !readFileSync(resolve(root, item.path)).equals(item.bytes));
    for (const item of changes) {
        const entry = index.assets.find(candidate => candidate.path === item.path);
        if (!entry || sha256(readFileSync(resolve(root, item.path))) !== entry.sha256) throw new Error(`Artwork changed outside the mapped export: ${item.path}`);
        const priorEntry = JSON.stringify(entry);
        Object.assign(entry, { sha256: sha256(item.bytes), status: 'unverified', figmaSha256: null, figmaImageSha1: null, evidence: null });
        updatedIndex = updatedIndex.replace(priorEntry, JSON.stringify(entry));
    }
    const originals = changes.map(item => ({ path: resolve(root, item.path), bytes: readFileSync(resolve(root, item.path)) }));
    const write = async (target, bytes, expected) => {
        const temporary = `${target}.design-${process.pid}.tmp`;
        try {
            writeFileSync(temporary, bytes);
            for (let attempt = 0; ; attempt++) {
                try {
                    if (!readFileSync(target).equals(expected)) throw new Error(`Artwork changed while saving: ${target}`);
                    await rename(temporary, target);
                    return;
                } catch (error) {
                    if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
                    await delay(50);
                }
            }
        } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    };
    const written = [];
    try {
        for (let i = 0; i < changes.length; i++) {
            await write(originals[i].path, changes[i].bytes, originals[i].bytes);
            written.push(i);
        }
        if (changes.length) await write(indexPath, JSON.stringify(JSON.parse(updatedIndex)) === JSON.stringify(index) ? updatedIndex : JSON.stringify(index, null, 2) + '\n', indexBytes);
    } catch (error) {
        const failures = [];
        for (const i of written.reverse()) {
            try { await write(originals[i].path, originals[i].bytes, changes[i].bytes); }
            catch (failure) { failures.push(failure); }
        }
        if (failures.length) throw new AggregateError([error, ...failures], `${error.message}; rollback failed: ${failures.map(failure => failure.message).join('; ')}`);
        throw error;
    }
    return changes.map(item => item.path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.length > 2) throw new Error('Usage: npm run dev:design -- [export.png|export.zip] [asset]');
    const path = resolve(args[0] ?? resolve(homedir(), 'Downloads/cells.garden.zip'));
    const asset = args[1] ?? 'gnome';
    const branch = (await import('node:child_process')).execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!branch || ['main', 'original'].includes(branch)) throw new Error('Run the design dev server on dev or a feature branch.');
    let server;
    const applyExport = async (path, options) => {
        const changed = await syncDesignExport(path, options);
        if (changed.length && server) {
            server.moduleGraph.invalidateAll();
            server.ws.send({ type: 'full-reload' });
        }
        return changed;
    };
    const bridge = createDesignBridge({ sync: applyExport });
    mkdirSync(dirname(path), { recursive: true });
    const version = () => {
        if (!existsSync(path)) return null;
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    };
    let importedVersion = args.length ? null : version();
    const sync = async () => {
        if (!existsSync(path)) return;
        try {
            const currentVersion = version();
            if (currentVersion === importedVersion) return;
            const changed = await applyExport(path, { asset });
            importedVersion = currentVersion;
            console.log(changed.length ? `Figma export applied: ${changed.join(', ')}` : 'Figma export matches the working tree.');
        } catch (error) { console.error(`Figma export retained for retry: ${error.message}`); }
    };
    await sync();
    server = await createServer({
        configFile: resolve(ROOT, 'vite.config.ts'),
        server: { host: '127.0.0.1', port: 5173, strictPort: true },
        plugins: [{ name: 'figma-live', configureServer(server) { server.middlewares.use(bridge.middleware); } }],
    });
    await server.listen();
    server.printUrls();
    console.log(`Watching native Figma exports: ${path}`);
    console.log(`Figma live plugin (${bridge.assetCount} PNGs): ${resolve(bridge.pluginDirectory, 'manifest.json')}`);
    let timer;
    const resync = changed => {
        if (resolve(changed) !== path) return;
        clearTimeout(timer);
        timer = setTimeout(() => { void sync(); }, 300);
    };
    server.watcher.add(path);
    server.watcher.on('add', resync);
    server.watcher.on('change', resync);
    await sync();
    const close = async () => { clearTimeout(timer); await syncing.catch(() => {}); await server.close(); process.exit(0); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}
