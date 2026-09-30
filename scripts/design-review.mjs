// Isolated before/after builds of the real garden. Review never changes source artwork.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { ROOT, stagedAsset, sha256 } from './design-assets.mjs';

const MODULE = fileURLToPath(import.meta.url);
const INPUTS = ['src', 'public', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];
const FIXED_TIME = '2026-09-30T12:00:00.000Z';
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
const requireThat = (value, message) => { if (!value) throw new Error(message); };

function children(root, path) {
    const full = resolve(root, path);
    const stat = lstatSync(full);
    requireThat(!stat.isSymbolicLink(), `Review inputs must not be symbolic links: ${path}`);
    return stat.isDirectory() ? readdirSync(full).sort().flatMap(name => children(root, `${path}/${name}`)) : [path];
}

export function rendererFingerprint(root = ROOT) {
    const files = INPUTS.flatMap(path => children(root, path)).map(path => [path, sha256(readFileSync(resolve(root, path)))]);
    return sha256(Buffer.from(JSON.stringify({ version: 1, files, reviewCode: sha256(readFileSync(MODULE)), node: process.version, browser: chromium.executablePath() })));
}

function contained(directory, path) {
    requireThat(typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').includes('..'), 'Unsafe review evidence path.');
    const full = resolve(directory, path);
    const rel = relative(realpathSync(directory), realpathSync(full));
    requireThat(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel), 'Review evidence escaped its staging directory.');
    requireThat(lstatSync(full).isFile(), 'Review evidence must be a regular file.');
    return full;
}

function stageDirectory(name, root) {
    requireThat(/^[a-zA-Z0-9_-]+$/.test(name), 'Invalid review asset key.');
    const path = resolve(root, '.design-staging', name);
    mkdirSync(path, { recursive: true });
    requireThat(realpathSync(path).startsWith(`${realpathSync(root)}${sep}`), 'Review staging escaped the workspace.');
    return path;
}

function fixtureFor(asset, root) {
    const type = /\/pack\/(plant_\d+)\//.exec(asset.path)?.[1] ?? 'plant_1';
    const pack = resolve(root, 'src/assets/pack');
    const paths = folder => readdirSync(resolve(pack, folder)).filter(name => name.endsWith('.png')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(name => `${folder}/${name}`);
    const chosen = asset.path.replace(/^src\/assets\/pack\//, '');
    const cells = (layer, folder, count) => {
        const available = paths(folder);
        return Array.from({ length: count }, (_, index) => ({ id: `review_${layer}_${index}`, content: `${layer} ${index + 1}`, isComplete: false,
            imagePath: index === 0 && chosen.startsWith(`${folder}/`) ? chosen : available[index % available.length] }));
    };
    return { version: 1, updatedAt: FIXED_TIME, settings: { fireflies: 0, mobileFireflies: 0, skyMode: 'static', skyNodes: [{ color: '#87ceeb', hour: 12 }], petCrow: false, petGnome: false, petPumpkin: false, items: [] },
        projects: [{ id: 'review_plant', name: 'Asset review', seed: 'Asset review', seedImagePath: /^seeds\/seed\d+\.png$/.test(chosen) ? chosen : 'seeds/seed1.png',
            standby: false, hue: 0, order: 0, plantType: type, stem: cells('stem', `${type}/stem`, 8), flowers: cells('flowers', `${type}/flowers`, 4),
            roots: cells('roots', 'roots', 3), minerals: cells('minerals', 'minerals', 5) }] };
}

async function buildCopy(workspace) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VITE_|SUPABASE_|CELLS_|VERCEL_)/.test(key)));
    Object.assign(env, { CELLS_EXTRAS: '0', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' });
    await new Promise((resolveBuild, reject) => {
        const child = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(workspace, 'vite.config.ts'), '--mode', 'design-review'],
            { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
        let log = '';
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-16000); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolveBuild() : reject(new Error(`Isolated garden build failed (${code}): ${log}`)));
    });
}

async function serverFor(dist) {
    const files = new Map(children(dist, '.').map(path => [`/${path.replace(/^\.\//, '')}`, resolve(dist, path)]));
    files.set('/', resolve(dist, 'index.html'));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const file = files.get(url.pathname);
        if (request.method !== 'GET' || !file) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(readFileSync(file));
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}

async function capture(browser, url, fixture, assetBytes, viewport, path) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, isMobile: viewport.name === 'mobile', hasTouch: viewport.name === 'mobile', locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark', serviceWorkers: 'block', reducedMotion: 'reduce' });
    const failures = [];
    try {
        await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort('blockedbyclient'));
        await context.routeWebSocket('**/*', socket => socket.close());
        await context.addInitScript(({ garden, size }) => {
            let seed = 124783;
            Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
            localStorage.clear();
            localStorage.setItem('cells.garden/v1', JSON.stringify(garden));
            localStorage.setItem('cells.garden/board', 'shown');
            localStorage.setItem('cells.garden/view/web', JSON.stringify({ zoom: 0.65, translateX: 40, translateY: 20, groundRatio: 0.65, viewportWidth: size.width, viewportHeight: size.height, kanbanScrollLeft: 0, kanbanScrollTop: 0 }));
        }, { garden: fixture, size: viewport });
        const page = await context.newPage();
        page.on('pageerror', error => failures.push(error.message));
        await page.clock.install({ time: new Date(FIXED_TIME) });
        await page.clock.pauseAt(new Date(FIXED_TIME));
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.clock.runFor(2000);
        await page.waitForFunction(() => window.garden && !document.querySelector('.garden-render-stage') && [...document.querySelectorAll('.garden-plant-wrapper')].every(element => element.dataset.width), undefined, { timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.clock.runFor(1000);
        requireThat(failures.length === 0, `Garden review page failed: ${failures.join('; ')}`);
        const sourceExercised = await page.evaluate(data => {
            if (window.garden.accounts) throw new Error('Garden review unexpectedly enabled accounts.');
            const token = `data:image/png;base64,${data}`;
            return [...document.querySelectorAll('*')].some(element => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
                return [style.backgroundImage, style.maskImage, style.webkitMaskImage, element.currentSrc].some(value => value?.includes(token));
            });
        }, assetBytes.toString('base64'));
        await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
        return { sourceExercised, plants: await page.locator('.garden-plant-wrapper').count(), cells: await page.locator('.garden-part[data-item-id]').count() };
    } finally { await context.close(); }
}

async function compare(browser, before, after, diffPath) {
    const page = await browser.newPage();
    try {
        const result = await page.evaluate(async ({ first, second }) => {
            const decode = async encoded => { const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode(); return image; };
            const a = await decode(first), b = await decode(second);
            if (a.width !== b.width || a.height !== b.height) throw new Error('Review screenshot dimensions differ.');
            const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(a, 0, 0); const left = ctx.getImageData(0, 0, a.width, a.height);
            ctx.clearRect(0, 0, a.width, a.height); ctx.drawImage(b, 0, 0); const right = ctx.getImageData(0, 0, b.width, b.height);
            const difference = ctx.createImageData(a.width, a.height); let changedPixels = 0, maxChannelDelta = 0;
            for (let i = 0; i < left.data.length; i += 4) {
                let changed = false;
                for (let c = 0; c < 4; c++) { const delta = Math.abs(left.data[i + c] - right.data[i + c]); maxChannelDelta = Math.max(maxChannelDelta, delta); changed ||= delta !== 0; }
                if (changed) { changedPixels++; difference.data.set([255, 0, 128, 255], i); }
                else difference.data.set([24, 24, 24, 255], i);
            }
            ctx.putImageData(difference, 0, 0);
            return { width: a.width, height: a.height, totalPixels: a.width * a.height, changedPixels, maxChannelDelta, differencePng: canvas.toDataURL('image/png').split(',')[1] };
        }, { first: readFileSync(before).toString('base64'), second: readFileSync(after).toString('base64') });
        const { differencePng, ...stats } = result;
        writeFileSync(diffPath, Buffer.from(differencePng, 'base64'));
        return { ...stats, changedRatio: stats.changedPixels / stats.totalPixels };
    } finally { await page.close(); }
}

async function decodePng(browser, bytes, asset) {
    const page = await browser.newPage();
    try {
        const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[bytes[25]];
        const depth = bytes[24];
        requireThat(channels && [1, 2, 4, 8, 16].includes(depth), 'Unsupported PNG pixel format.');
        const chunks = [];
        for (let offset = 8; offset < bytes.length;) {
            const size = bytes.readUInt32BE(offset);
            if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
            offset += size + 12;
        }
        const pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: asset.width * asset.height * 8 + asset.height * 16 + 1024 });
        const passes = bytes[28] === 0 ? [[0, 0, 1, 1]] : bytes[28] === 1
            ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [];
        requireThat(passes.length, 'Invalid PNG interlace mode.');
        let consumed = 0;
        for (const [x, y, dx, dy] of passes) {
            const width = Math.max(0, Math.ceil((asset.width - x) / dx));
            const height = Math.max(0, Math.ceil((asset.height - y) / dy));
            if (!width || !height) continue;
            const stride = Math.ceil(width * channels * depth / 8) + 1;
            for (let row = 0; row < height; row++) {
                requireThat(pixels[consumed] <= 4, 'Invalid or missing PNG scanline filter.');
                consumed += stride;
            }
        }
        requireThat(consumed === pixels.length, 'PNG scanlines are incomplete or contain extra data.');
        const dimensions = await page.evaluate(async encoded => {
            const image = new Image(); image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight };
        }, bytes.toString('base64'));
        requireThat(dimensions.width === asset.width && dimensions.height === asset.height, 'Decoded PNG dimensions do not match the native asset.');
        return { ...dimensions, sha256: sha256(bytes), decoded: true, scanlineBytes: consumed };
    } catch (error) {
        throw new Error(`PNG image decode failed: ${error.message}`, { cause: error });
    } finally { await page.close(); }
}

export async function buildGardenReview(name, { root = ROOT } = {}) {
    const { asset, report, bytes } = stagedAsset(name, root);
    const stage = stageDirectory(name, root);
    const rendererSha256 = rendererFingerprint(root);
    const work = mkdtempSync(resolve(stage, '.garden-build-'));
    const output = mkdtempSync(resolve(stage, 'garden-review-'));
    const baseline = readFileSync(resolve(root, asset.path));
    const fixture = fixtureFor(asset, root);
    let browser;
    const servers = [];
    try {
        browser = await chromium.launch({ headless: true });
        // Validate compressed image pixels before spending time on either build.
        const decodedImages = { baseline: await decodePng(browser, baseline, asset), candidate: await decodePng(browser, bytes, asset) };
        for (const variant of ['before', 'after']) {
            const copy = resolve(work, variant);
            mkdirSync(copy);
            for (const input of INPUTS) cpSync(resolve(root, input), resolve(copy, input), { recursive: true, dereference: false });
            symlinkSync(resolve(ROOT, 'node_modules'), resolve(copy, 'node_modules'), 'junction');
            if (variant === 'after') writeFileSync(resolve(copy, asset.path), bytes);
            await buildCopy(copy);
            servers.push(await serverFor(resolve(copy, 'dist')));
        }
        const files = [];
        const record = (path, label, kind) => files.push({ path: relative(stage, path).replaceAll('\\', '/'), sha256: sha256(readFileSync(path)), label, kind });
        const fixturePath = resolve(output, 'fixture.json'); writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n'); record(fixturePath, 'Deterministic local garden fixture', 'fixture');
        const comparisons = [];
        for (const viewport of VIEWPORTS) {
            const before = resolve(output, `${viewport.name}-before.png`), after = resolve(output, `${viewport.name}-after.png`), diff = resolve(output, `${viewport.name}-diff.png`);
            const beforeScene = await capture(browser, servers[0].url, fixture, baseline, viewport, before);
            const afterScene = await capture(browser, servers[1].url, fixture, bytes, viewport, after);
            const stats = await compare(browser, before, after, diff);
            record(before, `${viewport.name}: current garden`, 'before'); record(after, `${viewport.name}: candidate garden`, 'after'); record(diff, `${viewport.name}: changed pixels`, 'diff');
            comparisons.push({ viewport: viewport.name, ...stats, beforeScene, afterScene });
        }
        requireThat(rendererFingerprint(root) === rendererSha256, 'Renderer changed during review. Build the review again.');
        const current = stagedAsset(name, root);
        requireThat(current.report.baselineSha256 === report.baselineSha256 && current.report.candidateSha256 === report.candidateSha256, 'Artwork changed during review. Build the review again.');
        const sourceExercised = comparisons.every(comparison => comparison.beforeScene.sourceExercised && comparison.afterScene.sourceExercised);
        const review = { version: 1, asset: name, path: asset.path, baselineSha256: report.baselineSha256, candidateSha256: report.candidateSha256, rendererSha256,
            createdAt: new Date().toISOString(), renderer: 'isolated current web production build', browserVersion: browser.version(), network: 'loopback only; accounts, service workers and extras disabled', sourceExercised, decodedImages,
            limitations: sourceExercised ? ['Static local fixture; does not test animation or every possible garden.'] : ['Selected artwork was not visible in every production garden viewport; this review cannot approve that artwork.'], files, comparisons };
        writeFileSync(resolve(stage, 'review.json'), JSON.stringify(review, null, 2) + '\n');
        return review;
    } finally {
        await browser?.close();
        await Promise.all(servers.map(server => server.close()));
        const checked = realpathSync(work);
        requireThat(checked.startsWith(`${realpathSync(stage)}${sep}`), 'Refusing cleanup outside the isolated review workspace.');
        rmSync(checked, { recursive: true, force: true });
    }
}

export function validateGardenReview(name, { root = ROOT } = {}) {
    const { asset, report } = stagedAsset(name, root);
    const stage = stageDirectory(name, root);
    const review = JSON.parse(readFileSync(resolve(stage, 'review.json'), 'utf8'));
    requireThat(review.version === 1 && review.asset === name && review.path === asset.path, 'Review identity changed. Build the review again.');
    requireThat(review.baselineSha256 === report.baselineSha256 && review.candidateSha256 === report.candidateSha256, 'Review artwork changed. Build the review again.');
    requireThat(review.rendererSha256 === rendererFingerprint(root), 'Review renderer changed. Build the review again.');
    for (const [kind, digest] of [['baseline', report.baselineSha256], ['candidate', report.candidateSha256]]) {
        const decoded = review.decodedImages?.[kind];
        requireThat(decoded?.decoded === true && decoded.sha256 === digest && decoded.width === asset.width && decoded.height === asset.height
            && Number.isInteger(decoded.scanlineBytes) && decoded.scanlineBytes > 0, 'Review PNG decoding evidence is incomplete.');
    }
    requireThat(Array.isArray(review.files) && review.files.length === 7 && new Set(review.files.map(file => file.path)).size === 7, 'Review evidence is incomplete.');
    for (const file of review.files) requireThat(sha256(readFileSync(contained(stage, file.path))) === file.sha256, 'Review evidence changed. Build the review again.');
    for (const kind of ['before', 'after', 'diff']) requireThat(review.files.filter(file => file.kind === kind).length === 2, 'Review viewport evidence is incomplete.');
    requireThat(review.files.filter(file => file.kind === 'fixture').length === 1, 'Review fixture evidence is incomplete.');
    requireThat(Array.isArray(review.comparisons) && review.comparisons.length === 2 && VIEWPORTS.every(view => review.comparisons.some(comparison => comparison.viewport === view.name && comparison.width === view.width && comparison.height === view.height)), 'Review viewports changed. Build the review again.');
    requireThat(typeof review.sourceExercised === 'boolean', 'Review has no source visibility evidence.');
    requireThat(review.sourceExercised === review.comparisons.every(comparison => comparison.beforeScene?.sourceExercised === true && comparison.afterScene?.sourceExercised === true), 'Review source visibility evidence is inconsistent.');
    return review;
}
