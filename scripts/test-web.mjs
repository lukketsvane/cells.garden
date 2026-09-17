#!/usr/bin/env node
// Browser smoke test for the web build plus the PWA. Run with "npm run test:web".
//
// Starts "vite preview" on port 4173 against dist/ (building first when dist/
// is missing) and drives the garden with Playwright: plants seeds, adds cells
// to every zone, context menus, pan/zoom, reload persistence, a mobile
// viewport. Then the PWA: the manifest and sw.js are served, the service
// worker takes control of the page, and the garden still renders offline.
//
// Console errors that are exactly network failures to Supabase/Google are
// tolerated (a sandbox may block those hosts; the app copes). Any other
// console error or page error fails the run. Set SCREENSHOTS=<dir> to save
// screenshots along the way.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
// The build honours VITE_BASE; the test only sees it when it is in the environment.
const BASE_PATH = process.env.VITE_BASE || '/';
const BASE = `http://localhost:${PORT}${BASE_PATH}`;
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const SHOTS = process.env.SCREENSHOTS || '';
const ICONS = ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

// Hosts the app talks to that a sandbox may block; failures to them are noise.
const BLOCKED_HOSTS = /supabase\.co|google\.com/;
const NETWORK_FAILURE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to fetch|Failed to load resource/;

function isBlockedNetworkNoise(text, url = '') {
    if (!NETWORK_FAILURE.test(text)) return false;
    if (BLOCKED_HOSTS.test(url) || BLOCKED_HOSTS.test(text)) return true;
    // "TypeError: Failed to fetch" carries no URL; only the Supabase client uses fetch() here.
    return /Failed to fetch/.test(text) && !/localhost|127\.0\.0\.1/.test(text);
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function shot(page, name) {
    if (SHOTS) await page.screenshot({ path: join(SHOTS, name) });
}

function watchErrors(page, label, errors) {
    page.on('pageerror', (e) => {
        if (!isBlockedNetworkNoise(e.message)) errors.push(`${label} pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        if (isBlockedNetworkNoise(m.text(), m.location()?.url)) return;
        errors.push(`${label} console: ${m.text()}`);
    });
}

// ---------------------------------------------------------------------------
// Build + preview server
// ---------------------------------------------------------------------------

function ensureBuild() {
    if (existsSync(join(ROOT, 'dist', 'index.html'))) return;
    console.log('dist/index.html missing, running "npm run build" first');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`npm run build failed (exit code ${result.status})`);
}

async function startPreview() {
    const child = spawn(process.execPath, [VITE, 'preview', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    let exited = null;
    child.on('exit', (code, signal) => { exited = { code, signal }; });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (exited) throw new Error(`vite preview exited early (${exited.code ?? exited.signal}):\n${output}`);
        // Only trust a response once our own server has announced itself; with
        // --strictPort a stale server on the port would otherwise pass as ours.
        if (output.includes(`localhost:${PORT}`)) {
            try {
                const res = await fetch(BASE);
                if (res.ok) return child;
            } catch {
                // Not listening yet.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    child.kill('SIGKILL');
    throw new Error(`vite preview did not answer on ${BASE} within 30 s:\n${output}`);
}

function stopPreview(child) {
    return new Promise((resolve) => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
        const force = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => { clearTimeout(force); resolve(); });
        child.kill('SIGTERM');
    });
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

async function scenario(browser, errors) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watchErrors(page, 'desktop', errors);

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.garden-canvas-viewport');
    console.log('empty msg:', await page.textContent('.kanban-empty-message h3'));
    await shot(page, '01-empty.png');

    // Plant a seed
    await page.click('.add-column-btn-inner >> nth=1');
    await page.waitForSelector('.modal textarea');
    await page.fill('.modal textarea', 'Port the garden to the web');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.project-column');
    console.log('seed:', await page.textContent('.seed-content'));

    // Add items to each zone
    const zones = [
        ['flowers-zone', 'Runs in browser'],
        ['stem-zone', 'Scaffold + shim'],
        ['roots-zone', 'Friends can use it without Obsidian'],
        ['minerals-zone', 'Supabase sync'],
    ];
    for (const [zone, text] of zones) {
        await page.click(`.${zone} .zone-add-btn`);
        await page.waitForSelector('.modal input[type=text]');
        await page.fill('.modal input[type=text]', text);
        await page.keyboard.press('Enter');
        await page.waitForFunction((t) => [...document.querySelectorAll('.garden-item')].some((el) => el.textContent === t), text);
    }
    await page.waitForTimeout(600);
    const items = await page.$$eval('.garden-item', (els) => els.map((e) => e.textContent));
    console.log('items:', items);
    assert(items.length === zones.length, `expected ${zones.length} items, got ${items.length}`);
    console.log('plant parts:', await page.$$eval('.garden-stem-container > div', (els) => els.map((e) => e.className)));
    await shot(page, '02-one-plant.png');

    // Second plant on the left
    await page.click('.add-column-btn-inner >> nth=0');
    await page.fill('.modal textarea', 'Second plant');
    await page.click('.modal button.mod-cta');
    await page.waitForFunction(() => document.querySelectorAll('.project-column').length === 2);
    console.log('columns:', await page.$$eval('.seed-content', (els) => els.map((e) => e.textContent)));

    // Context menu on a cell -> highlight
    await page.click('.garden-item >> nth=0', { button: 'right' });
    await page.waitForSelector('.garden-context-menu');
    console.log('cell menu:', await page.$$eval('.garden-context-menu button', (els) => els.map((e) => e.textContent)));
    await page.click('.garden-context-menu button:has-text("Highlight")');
    await page.waitForTimeout(300);

    // Seed context menu
    await page.click('.seed-content >> nth=1', { button: 'right' });
    await page.waitForSelector('.garden-context-menu');
    console.log('seed menu:', await page.$$eval('.garden-context-menu button, .garden-context-menu div', (els) => els.map((e) => e.textContent)));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    // Pan + zoom on the canvas
    const viewport = await page.$('.garden-canvas-viewport');
    const box = await viewport.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(1300); // let the debounced view-state save fire
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/v1')));
    // The camera is per surface and stays on the device (not in the synced blob).
    const viewState = await page.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/view/web') || 'null'));
    console.log('saved projects:', saved.projects.length, 'viewState:', viewState && Object.keys(viewState));
    const highlighted = saved.projects
        .flatMap((p) => [...p.flowers, ...p.stem, ...p.roots, ...p.minerals])
        .filter((i) => i.highlighted)
        .map((i) => i.content);
    console.log('highlighted:', highlighted);
    assert(saved.projects.length === 2, `expected 2 saved projects, got ${saved.projects.length}`);
    assert(viewState && typeof viewState.zoom === 'number', 'view state was not saved');
    assert(!saved.settings.viewState, 'view state must not be written into the synced garden');
    assert(highlighted.length === 1, `expected 1 highlighted cell, got ${highlighted.length}`);
    await shot(page, '03-two-plants.png');

    // Reload -> persisted
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.project-column');
    const columns = await page.$$eval('.seed-content', (els) => els.map((e) => e.textContent));
    console.log('after reload columns:', columns);
    console.log('after reload items:', (await page.$$('.garden-item')).length);
    assert(columns.length === 2, `expected 2 columns after reload, got ${columns.length}`);

    // --- PWA: manifest and service worker are served ---------------------------
    const manifestRes = await fetch(new URL('manifest.webmanifest', BASE));
    assert(manifestRes.ok, `manifest.webmanifest: HTTP ${manifestRes.status}`);
    const manifestType = manifestRes.headers.get('content-type') ?? '';
    assert(/json/.test(manifestType), `manifest.webmanifest content-type: ${manifestType}`);
    const manifest = await manifestRes.json();
    const iconSrcs = (manifest.icons ?? []).map((icon) => String(icon.src).replace(/^\.?\//, ''));
    for (const icon of ICONS) assert(iconSrcs.includes(icon), `manifest icons missing ${icon}: ${iconSrcs.join(', ')}`);
    assert(manifest.name === 'cells.garden', `manifest name: ${manifest.name}`);
    assert(manifest.display === 'standalone', `manifest display: ${manifest.display}`);
    for (const icon of ICONS) {
        const res = await fetch(new URL(icon, BASE));
        assert(res.ok, `${icon}: HTTP ${res.status}`);
    }
    console.log('manifest icons:', iconSrcs);

    const swRes = await fetch(new URL('sw.js', BASE));
    assert(swRes.ok, `sw.js: HTTP ${swRes.status}`);
    const swType = swRes.headers.get('content-type') ?? '';
    assert(/javascript/.test(swType), `sw.js content-type: ${swType}`);
    const swSource = await swRes.text();
    assert(swSource.includes('index.html'), 'sw.js does not precache index.html');
    console.log('sw.js bytes:', swSource.length);

    // The built page links the manifest exactly once (injected by vite-plugin-pwa).
    const manifestLinks = await page.$$eval('link[rel="manifest"]', (els) => els.map((e) => e.getAttribute('href')));
    assert(manifestLinks.length === 1, `expected one <link rel="manifest">, got ${JSON.stringify(manifestLinks)}`);

    // --- PWA: the service worker controls the page ------------------------------
    const swState = () => page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return null;
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('serviceWorker.ready timed out')), 15000));
        const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
        return { scope: reg.scope, controller: navigator.serviceWorker.controller?.scriptURL ?? null };
    });
    let sw = await swState();
    assert(sw, 'navigator.serviceWorker is not available');
    if (!sw.controller) {
        // clientsClaim normally takes over the first visit; a reload is the fallback.
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
        sw = await swState();
        if (!sw.controller) {
            await page.reload({ waitUntil: 'load' });
            sw = await swState();
        }
    }
    assert(sw.controller && sw.controller.endsWith('/sw.js'), `page is not controlled by sw.js: ${JSON.stringify(sw)}`);
    console.log('service worker:', sw);

    // --- PWA: the garden opens offline ------------------------------------------
    // Any same-origin request that fails while offline is a file missing from
    // the precache (see globPatterns in vite.config.ts).
    const offlineMisses = [];
    page.on('requestfailed', (req) => {
        if (req.url().startsWith(`http://localhost:${PORT}/`)) offlineMisses.push(`${req.url()} (${req.failure()?.errorText})`);
    });
    await ctx.setOffline(true);
    const offlineRes = await page.reload({ waitUntil: 'load' });
    assert(offlineRes && offlineRes.ok(), `offline reload: HTTP ${offlineRes?.status()}`);
    assert(offlineRes.fromServiceWorker(), 'offline document was not served by the service worker');
    await page.waitForSelector('.garden-canvas-viewport');
    await page.waitForSelector('.project-column');
    await page.waitForTimeout(600); // let the plants render, so sprite requests (if any) happen
    const offlineColumns = await page.$$eval('.seed-content', (els) => els.map((e) => e.textContent));
    console.log('offline columns:', offlineColumns, 'items:', (await page.$$('.garden-item')).length);
    assert(offlineColumns.length === 2, `expected 2 columns offline, got ${offlineColumns.length}`);
    assert(offlineMisses.length === 0, `same-origin requests failed offline (not precached?):\n - ${offlineMisses.join('\n - ')}`);
    await shot(page, '05-offline.png');
    await ctx.setOffline(false);
    await ctx.close();

    // Mobile viewport
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const mpage = await mctx.newPage();
    watchErrors(mpage, 'mobile', errors);
    await mpage.goto(BASE, { waitUntil: 'networkidle' });
    await mpage.waitForSelector('.garden-canvas-viewport');
    await shot(mpage, '04-mobile-dark.png');
    await mctx.close();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const errors = [];
let preview = null;
let browser = null;
let exitCode = 0;

process.on('SIGINT', () => { stopPreview(preview).then(() => process.exit(130)); });

try {
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    ensureBuild();
    preview = await startPreview();
    browser = await chromium.launch();
    await scenario(browser, errors);
    if (errors.length) throw new Error(`unexpected page/console errors:\n - ${errors.join('\n - ')}`);
    console.log('test:web passed');
} catch (e) {
    console.error('test:web FAILED:', e);
    exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    await stopPreview(preview);
}
process.exit(exitCode);
