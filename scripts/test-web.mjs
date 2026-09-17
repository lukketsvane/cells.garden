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
    const emptyMsg = await page.textContent('.kanban-empty-message h3');
    console.log('empty msg:', emptyMsg);
    assert(/empty/i.test(emptyMsg), 'a fresh garden should say it is empty');
    await shot(page, '01-empty.png');

    // The garden on top, the divider, the board below: separate panes.
    const panes = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { canvas: r('.garden-canvas-viewport'), resizer: r('.garden-resizer'), board: r('.kanban-scroll-container') };
    });
    console.log('panes:', JSON.stringify(panes));
    assert(Math.abs(panes.canvas.bottom - panes.resizer.top) < 2 && Math.abs(panes.resizer.bottom - panes.board.top) < 2, `canvas, divider and board must stack: ${JSON.stringify(panes)}`);
    assert(panes.canvas.height > 200 && panes.board.height > 200, `both panes need room: ${JSON.stringify(panes)}`);

    // Plant a seed
    await page.click('.add-plant-btn');
    await page.waitForSelector('.modal textarea');
    await page.fill('.modal textarea', 'Port the garden to the web');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.project-column');
    assert((await page.$('.kanban-empty-message')) === null, 'the empty message must go once a plant exists');
    assert((await page.$('.garden-canvas-viewport .project-column')) === null, 'the cells belong on the board, not in the canvas');
    console.log('seed:', await page.textContent('.seed-content'));

    // Add items to each zone: typed in place, no modal.
    const zones = [
        ['flowers-zone', 'Runs in browser'],
        ['stem-zone', 'Scaffold + shim'],
        ['roots-zone', 'Friends can use it without Obsidian'],
        ['minerals-zone', 'Supabase sync'],
    ];
    for (const [zone, text] of zones) {
        await page.click(`.${zone} .zone-add-btn`);
        await page.waitForSelector(`.${zone} .garden-item.is-editing`);
        assert(await page.getAttribute(`.${zone} .garden-item.is-editing`, 'data-placeholder'), `${zone}: the new cell should show a hint`);
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
        await page.waitForFunction((t) => [...document.querySelectorAll('.garden-item')].some((el) => el.textContent === t), text);
    }
    // An empty new cell disappears again.
    await page.click('.stem-zone .zone-add-btn');
    await page.waitForSelector('.stem-zone .garden-item.is-editing');
    await page.keyboard.press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.garden-item').length === n, zones.length);
    await page.waitForTimeout(600);
    const items = await page.$$eval('.garden-item', (els) => els.map((e) => e.textContent));
    console.log('items:', items);
    assert(items.length === zones.length, `expected ${zones.length} items, got ${items.length}`);
    console.log('plant parts:', await page.$$eval('.garden-stem-container > div', (els) => els.map((e) => e.className)));
    // The column's bands stack in the order the plant stands: flowers, stem, seed, roots, minerals.
    const order = await page.evaluate(() => ['.flowers-zone', '.stem-zone', '.seed-cell', '.roots-zone', '.minerals-zone']
        .map((s) => document.querySelector(`.project-column > ${s}`).getBoundingClientRect().y));
    console.log('band tops:', order);
    assert(order.every((y, i) => i === 0 || y > order[i - 1]), `the bands are out of order: ${order}`);
    await shot(page, '02-one-plant.png');

    // Second plant, from the + at the end of the seed row
    await page.click('.add-plant-btn');
    await page.fill('.modal textarea', 'Second plant');
    await page.click('.modal button.mod-cta');
    await page.waitForFunction(() => document.querySelectorAll('.project-column').length === 2);
    console.log('columns:', await page.$$eval('.seed-content', (els) => els.map((e) => e.textContent)));

    // One board: every band lines up across the plants, although the first plant has more cells.
    const bands = await page.evaluate(() => ['.flowers-zone', '.stem-zone', '.seed-cell', '.roots-zone', '.minerals-zone'].map((s) =>
        [...document.querySelectorAll(`.project-column > ${s}`)].map((el) => { const b = el.getBoundingClientRect(); return [Math.round(b.y), Math.round(b.height)]; })));
    console.log('bands per column:', JSON.stringify(bands));
    for (const band of bands) {
        assert(band.length === 2 && band[0][0] === band[1][0] && band[0][1] === band[1][1], `a band does not line up across plants: ${JSON.stringify(bands)}`);
    }
    const noCards = await page.$$eval('.column-card', (els) => els.length);
    assert(noCards === 0, 'plants must not be boxed in cards of their own');

    // The divider drags with a mouse, and stays where it was left.
    const canvasBefore = (await (await page.$('.garden-canvas-area')).boundingBox()).height;
    const divider = await (await page.$('.garden-resizer')).boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2 - 120, { steps: 6 });
    await page.mouse.up();
    const canvasAfter = (await (await page.$('.garden-canvas-area')).boundingBox()).height;
    console.log('canvas height after dragging the divider:', canvasBefore, '->', canvasAfter);
    assert(Math.abs(canvasBefore - 120 - canvasAfter) < 6, `the divider did not follow the mouse: ${canvasBefore} -> ${canvasAfter}`);

    // Move it left from the seed menu; the order is saved.
    await page.click('.seed-content >> nth=1', { button: 'right' });
    await page.waitForSelector('.garden-context-menu');
    await page.click('.garden-context-menu button:has-text("Move left")');
    await page.waitForFunction(() => document.querySelector('.seed-content')?.textContent === 'Second plant');
    console.log('after move:', await page.$$eval('.seed-content', (els) => els.map((e) => e.textContent)));

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

    // Pan + zoom on the canvas (start on empty sky, not on a cell)
    const viewport = await page.$('.garden-canvas-viewport');
    const box = await viewport.boundingBox();
    const before = await page.evaluate(() => document.querySelector('.garden-world').style.transform);
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 80, { steps: 5 });
    await page.mouse.up();
    const after = await page.evaluate(() => document.querySelector('.garden-world').style.transform);
    assert(before !== after, 'dragging the sky did not pan the world');
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
    assert(typeof viewState.splitRatio === 'number', 'the divider position was not saved');
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
    const canvasReloaded = (await (await page.$('.garden-canvas-area')).boundingBox()).height;
    assert(Math.abs(canvasReloaded - canvasAfter) < 3, `the divider did not come back where it was left: ${canvasAfter} -> ${canvasReloaded}`);

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
    // Garden above, board below, both on screen; nothing scrolls sideways.
    const mobile = await mpage.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { canvas: r('.garden-canvas-viewport'), board: r('.kanban-scroll-container'), button: r('.add-plant-btn'), innerH: innerHeight, scrollW: document.documentElement.scrollWidth };
    });
    console.log('mobile:', JSON.stringify(mobile));
    assert(mobile.canvas.height >= 150 && mobile.board.height >= mobile.canvas.height, `on a phone the board should get the larger pane: ${JSON.stringify(mobile)}`);
    assert(mobile.board.bottom <= mobile.innerH + 1, `the board runs off the screen: ${JSON.stringify(mobile)}`);
    assert(mobile.button.bottom <= mobile.innerH && mobile.button.right <= 390, `the plant button is off screen: ${JSON.stringify(mobile)}`);
    assert(mobile.scrollW <= 390, `the page scrolls sideways on a phone: ${mobile.scrollW}`);
    // Tap + on a phone opens the seed modal, and it fits.
    await mpage.tap('.add-plant-btn');
    await mpage.waitForSelector('.modal textarea');
    const mModal = await (await mpage.$('.modal')).boundingBox();
    assert(mModal.x >= 0 && mModal.x + mModal.width <= 390, `the modal does not fit a phone: ${JSON.stringify(mModal)}`);
    await mpage.fill('.modal textarea', 'Phone plant');
    await mpage.keyboard.press('Enter');
    await mpage.waitForFunction(() => document.querySelectorAll('.project-column').length === 1);
    const mColumn = await (await mpage.$('.project-column')).boundingBox();
    assert(mColumn.x >= 0 && mColumn.width <= 390 / 2, `two plants should fit side by side on a phone: ${JSON.stringify(mColumn)}`);
    // Tapping + in a zone opens an inline cell, typed straight away.
    await mpage.tap('.stem-zone .zone-add-btn');
    await mpage.waitForSelector('.stem-zone .garden-item.is-editing');
    assert(await mpage.evaluate(() => document.activeElement?.classList.contains('is-editing')), 'the new cell must have focus, or a phone shows no keyboard');
    await mpage.keyboard.type('Typed on a phone');
    await mpage.keyboard.press('Enter');
    const typed = '.garden-item:has-text("Typed on a phone")';
    await mpage.waitForSelector(typed);
    // No double-click on a phone: tap once selects, a second tap edits.
    await mpage.waitForTimeout(700);
    await mpage.tap(typed);
    await mpage.waitForSelector('.garden-item.is-selected:has-text("Typed on a phone")');
    await mpage.waitForTimeout(700);
    await mpage.tap(typed);
    await mpage.waitForSelector('.garden-item.is-editing');
    await mpage.keyboard.press('Escape');
    await mpage.waitForFunction(() => !document.querySelector('.is-editing'));
    // No right-click either: holding a cell and letting go opens its menu.
    const cdp = await mctx.newCDPSession(mpage);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const cell = await (await mpage.waitForSelector(typed)).boundingBox();
    await touch('touchStart', cell.x + cell.width / 2, cell.y + cell.height / 2);
    await mpage.waitForTimeout(600);
    await touch('touchEnd');
    await mpage.waitForSelector('.garden-context-menu');
    const held = await mpage.$$eval('.garden-context-menu button', (els) => els.map((e) => e.textContent));
    console.log('long-press menu:', held);
    assert(held.includes('Edit') && held.includes('Delete'), `the long-press menu is missing its actions: ${held}`);
    await mpage.waitForTimeout(700);
    await mpage.tap('.garden-canvas-viewport');
    await mpage.waitForFunction(() => !document.querySelector('.garden-context-menu'));
    // The divider drags with a finger too.
    const mDivider = await (await mpage.$('.garden-resizer')).boundingBox();
    const mCanvasBefore = (await (await mpage.$('.garden-canvas-area')).boundingBox()).height;
    const dx = mDivider.x + mDivider.width / 2;
    const dy = mDivider.y + mDivider.height / 2;
    await touch('touchStart', dx, dy);
    for (let step = 1; step <= 6; step++) await touch('touchMove', dx, dy + step * 15);
    await touch('touchEnd');
    const mCanvasAfter = (await (await mpage.$('.garden-canvas-area')).boundingBox()).height;
    console.log('phone canvas height after dragging the divider:', mCanvasBefore, '->', mCanvasAfter);
    assert(Math.abs(mCanvasBefore + 90 - mCanvasAfter) < 6, `the divider did not follow the finger: ${mCanvasBefore} -> ${mCanvasAfter}`);
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
