#!/usr/bin/env node
// End-to-end check of the Chrome extension build in dist-ext/. Builds it when
// it is stale, loads it into Chromium with Playwright, exercises the New Tab
// page, the Side Panel page and the popup, and fails on any console error or page error
// that is not a plain network failure (the app tolerates being offline).
// Run with "npm run test:ext".
//
// Headless: Playwright's `channel: 'chromium'` picks the full Chromium binary
// (not the headless shell). Its new headless mode loads unpacked extensions,
// so no display server is needed.
//
// Environment:
//   EXT_TEST_FORCE_BUILD=1        always rebuild dist-ext/ first
//   EXT_TEST_SCREENSHOTS=<dir>    also save newtab.png and sidepanel.png there
//   EXT_TEST_TMP=<dir>            where the throwaway browser profile goes
//                                 (default: the OS temp dir). Keep TMPDIR itself
//                                 short: Chromium puts Unix sockets under it and
//                                 dies at startup when their path exceeds 108 bytes.

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnv } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-ext');
const MANIFEST = join(DIST, 'manifest.json');
const SCREENSHOT_DIR = process.env.EXT_TEST_SCREENSHOTS || '';

const SEED = 'Port the garden to the extension';
const SEED_2 = 'Show one plant in the popup';
const STEM = 'Scaffold + shim';
const FLOWER = 'Side panel works';

// Console / page errors that only mean "no network here" and are ignored.
const NETWORK_FAILURE = [/ERR_TUNNEL_CONNECTION_FAILED/, /Failed to fetch/, /Failed to load resource/];

// ---------------------------------------------------------------------------
// 1. Build, unless dist-ext/ is newer than everything it is built from.
// ---------------------------------------------------------------------------

function newestMtime(path) {
    if (!existsSync(path)) return 0;
    const stat = statSync(path);
    if (!stat.isDirectory()) return stat.mtimeMs;
    let newest = stat.mtimeMs;
    for (const entry of readdirSync(path)) {
        newest = Math.max(newest, newestMtime(join(path, entry)));
    }
    return newest;
}

function distIsFresh() {
    if (!existsSync(MANIFEST)) return false;
    const built = statSync(MANIFEST).mtimeMs;
    const sources = ['ext', 'src', 'vite.ext.config.ts', 'package.json', 'package-lock.json'];
    for (const entry of readdirSync(ROOT)) {
        if (entry.startsWith('.env')) sources.push(entry);
    }
    return sources.every((source) => newestMtime(join(ROOT, source)) < built);
}

if (process.env.EXT_TEST_FORCE_BUILD || !distIsFresh()) {
    console.log('test-ext: building dist-ext/');
    execSync('npm run build:ext', { cwd: ROOT, stdio: 'inherit' });
} else {
    console.log('test-ext: dist-ext/ is up to date, skipping the build');
}

// ---------------------------------------------------------------------------
// 2. Static checks on the build output.
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
assert(manifest.manifest_version === 3, 'manifest_version must be 3');
assert(manifest.name === 'cells.garden', `unexpected name ${manifest.name}`);
assert(JSON.stringify(manifest.permissions) === JSON.stringify(['sidePanel', 'storage']), `permissions must be sidePanel + storage, got ${JSON.stringify(manifest.permissions)}`);
assert(JSON.stringify(manifest.externally_connectable?.matches) === JSON.stringify(['https://cells.garden/*']), `only cells.garden should be able to message the extension: ${JSON.stringify(manifest.externally_connectable)}`);
assert(!('host_permissions' in manifest), 'host_permissions must not be set');
assert(!('optional_permissions' in manifest), 'optional_permissions must not be set');
assert(!('web_accessible_resources' in manifest), 'OAuth must use the website message bridge, not expose extension pages to the web');
assert(manifest.background?.service_worker === 'background.js' && manifest.background?.type === 'module', 'background must be the module service worker background.js');
assert(existsSync(join(DIST, 'background.js')), 'dist-ext/background.js is missing');
assert(manifest.chrome_url_overrides?.newtab === 'newtab.html', 'chrome_url_overrides.newtab must be newtab.html');
assert(manifest.side_panel?.default_path === 'sidepanel.html', 'side_panel.default_path must be sidepanel.html');
assert(manifest.action?.default_popup === 'popup.html', 'action.default_popup must be popup.html');
assert(manifest.minimum_chrome_version === '116', 'minimum_chrome_version must be 116 (chrome.sidePanel.open)');
for (const size of [16, 32, 48, 128]) {
    assert(existsSync(join(DIST, manifest.icons?.[size] ?? '')), `icons.${size} must point at a file in dist-ext/`);
    assert(existsSync(join(DIST, manifest.action?.default_icon?.[size] ?? '')), `action.default_icon.${size} must point at a file in dist-ext/`);
}
for (const page of ['newtab.html', 'sidepanel.html', 'popup.html']) {
    const html = readFileSync(join(DIST, page), 'utf8');
    // MV3's content security policy forbids inline scripts on extension pages.
    assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), `${page} contains an inline <script>`);
    assert(/<script\b[^>]*\bsrc="\.\/assets\//.test(html), `${page} does not load its module from ./assets/`);
}

// Sign-in is only part of the UI when the build carries Supabase config.
const env = loadEnv('production', ROOT, '');
const supabaseUrl = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').trim();
const hasSupabase = supabaseUrl !== '';
const extensionCsp = manifest.content_security_policy?.extension_pages ?? '';
for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
    assert(extensionCsp.includes(directive), `extension CSP missing ${directive}: ${extensionCsp}`);
}
if (hasSupabase) {
    const supabase = new URL(supabaseUrl);
    assert(extensionCsp.includes(supabase.origin), `extension CSP does not allow Supabase HTTPS: ${extensionCsp}`);
    assert(extensionCsp.includes(`wss://${supabase.host}`), `extension CSP does not allow Supabase realtime: ${extensionCsp}`);
}
console.log(`test-ext: manifest ok (version ${manifest.version}, supabase ${hasSupabase ? 'configured' : 'not configured'})`);

// ---------------------------------------------------------------------------
// 3. Load the extension into Chromium and drive both surfaces.
// ---------------------------------------------------------------------------

const errors = [];
function watch(page, label) {
    const record = (kind, text) => {
        if (NETWORK_FAILURE.some((re) => re.test(text))) {
            console.log(`test-ext: ${label} ignored network failure (${kind}): ${text.split('\n')[0]}`);
            return;
        }
        errors.push(`${label} ${kind}: ${text}`);
    };
    page.on('pageerror', (e) => record('pageerror', e.message));
    page.on('console', (m) => { if (m.type() === 'error') record('console', m.text()); });
}

async function screenshot(page, name) {
    if (!SCREENSHOT_DIR) return;
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}

const profileBase = process.env.EXT_TEST_TMP || tmpdir();
mkdirSync(profileBase, { recursive: true });
const userDataDir = mkdtempSync(join(profileBase, 'cells-garden-ext-'));
let context;
let failure = null;
try {
    context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });

    // The extension id is per profile; the service worker URL carries it.
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(worker.url()).host;
    assert(worker.url() === `chrome-extension://${extId}/background.js`, `unexpected service worker url ${worker.url()}`);
    console.log(`test-ext: extension loaded as ${extId}`);

    // The toolbar icon shows the popup; the side panel must not claim the click.
    // Playwright's headless Chromium can omit the sidePanel namespace entirely,
    // so assert the behavior when that browser API is available. The sidepanel
    // page itself is still exercised below in every run.
    const hasSidePanelBehaviorApi = await worker.evaluate(
        () => typeof chrome.sidePanel?.getPanelBehavior === 'function',
    );
    if (hasSidePanelBehaviorApi) {
        let behavior = null;
        for (let i = 0; i < 20 && behavior === null; i++) {
            behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
            if (behavior === null) await new Promise((r) => setTimeout(r, 100));
        }
        assert(behavior && behavior.openPanelOnActionClick !== true, `the side panel must not open on the action click: ${JSON.stringify(behavior)}`);
    } else {
        console.log('test-ext: headless Chromium has no chrome.sidePanel behavior API; testing the sidepanel page directly');
    }

    // Dedicated callback still works (used by email-link auth).
    const bridge = await context.newPage();
    const bridgeHtml = readFileSync(join(ROOT, 'public/privacy/oauth-return.html'), 'utf8');
    const bridgeJs = readFileSync(join(ROOT, 'public/privacy/oauth-return.js'), 'utf8');
    const startHtml = readFileSync(join(ROOT, 'public/privacy/oauth-extension-start.html'), 'utf8');
    const startJs = readFileSync(join(ROOT, 'public/privacy/oauth-extension-start.js'), 'utf8');
    const rootReturnJs = readFileSync(join(ROOT, 'public/privacy/oauth-extension-return.js'), 'utf8');
    await bridge.route('https://cells.garden/privacy/oauth-return.html**', (route) => route.fulfill({
        contentType: 'text/html',
        body: bridgeHtml,
    }));
    await bridge.route('https://cells.garden/privacy/oauth-return.js', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: bridgeJs,
    }));
    await bridge.route('https://cells.garden/privacy/oauth-extension-start.html**', (route) => route.fulfill({
        contentType: 'text/html',
        body: startHtml,
    }));
    await bridge.route('https://cells.garden/privacy/oauth-extension-start.js', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: startJs,
    }));
    await bridge.route('https://cells.garden/privacy/oauth-extension-return.js', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: rootReturnJs,
    }));
    await bridge.route('https://cells.garden/not-oauth', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body>not oauth</body>',
    }));
    await bridge.goto(`https://cells.garden/privacy/oauth-return.html?target=extension&extension_id=${extId}&code=test-oauth-code`);
    await bridge.waitForFunction(() => document.body.textContent?.includes('Return to cells.garden'));
    assert(new URL(bridge.url()).search === '', `OAuth callback left secrets in the URL: ${bridge.url()}`);
    const bridged = await worker.evaluate(async () => (await chrome.storage.local.get('cells.garden/oauth-return'))['cells.garden/oauth-return']);
    assert(bridged?.value?.code === 'test-oauth-code' && typeof bridged?.receivedAt === 'number',
        `website OAuth return did not reach the extension worker safely: ${JSON.stringify(bridged)}`);
    await worker.evaluate(async () => chrome.storage.local.remove('cells.garden/oauth-return'));

    // Regression: Supabase can fall back to its Site URL (/) even when the
    // extension requested /privacy/oauth-return.html. The start bridge leaves
    // a same-tab intent in sessionStorage, and root must return the code to the
    // extension before the web app can consume it.
    if (hasSupabase) {
        const nonce = '0123456789abcdef0123456789abcdef';
        await worker.evaluate(async ({ nonce }) => {
            await chrome.storage.local.set({
                'cells.garden/oauth-intent': { nonce, createdAt: Date.now() },
            });
        }, { nonce });

        const supabaseOrigin = new URL(supabaseUrl).origin;
        await bridge.route(`${supabaseOrigin}/auth/v1/authorize**`, (route) => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><script>location.replace("https://cells.garden/?code=root-fallback-code")</script>',
        }));
        await bridge.route(/https:\/\/cells\.garden\/\?code=root-fallback-code$/, (route) => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><head><script src="/privacy/oauth-extension-return.js"></script></head><body><div id="app"></div></body></html>',
        }));

        const authorize = new URL(`${supabaseOrigin}/auth/v1/authorize`);
        authorize.searchParams.set('provider', 'google');
        authorize.searchParams.set('redirect_to', 'https://cells.garden/');
        authorize.searchParams.set('code_challenge', 'test-challenge');
        authorize.searchParams.set('code_challenge_method', 's256');
        const start = new URL('https://cells.garden/privacy/oauth-extension-start.html');
        start.hash = new URLSearchParams({
            extension_id: extId,
            nonce,
            authorize_url: authorize.toString(),
        }).toString();

        await bridge.goto(start.toString());
        await bridge.waitForFunction(() =>
            location.origin === 'https://cells.garden'
            && location.pathname === '/'
            && location.search === ''
        );
        await bridge.waitForFunction(() =>
            document.body.textContent?.includes('Sign-in returned to the extension')
        );

        const fallback = await worker.evaluate(async () =>
            (await chrome.storage.local.get('cells.garden/oauth-return'))['cells.garden/oauth-return']
        );
        assert(fallback?.value?.code === 'root-fallback-code', `root fallback code was not bridged: ${JSON.stringify(fallback)}`);
        assert(fallback?.value?.nonce === nonce, `root fallback nonce was not preserved: ${JSON.stringify(fallback)}`);
        assert((await worker.evaluate(async () =>
            (await chrome.storage.local.get('cells.garden/oauth-intent'))['cells.garden/oauth-intent']
        )) === undefined, 'accepted OAuth intent must be consumed');
        await worker.evaluate(async () => chrome.storage.local.remove('cells.garden/oauth-return'));

        const replay = await bridge.evaluate(({ id, nonce }) => new Promise((resolve) => {
            chrome.runtime.sendMessage(id, {
                type: 'cells-garden-oauth-return',
                code: 'replayed-code',
                nonce,
            }, resolve);
        }), { id: extId, nonce });
        assert(replay?.ok === false, `consumed root OAuth nonce was replayable: ${JSON.stringify(replay)}`);
    }

    await bridge.goto('https://cells.garden/not-oauth');
    const rejected = await bridge.evaluate((id) => new Promise((resolve) => {
        chrome.runtime.sendMessage(id, { type: 'cells-garden-oauth-return', code: 'injected' }, resolve);
    }), extId);
    assert(rejected?.ok === false, `non-callback cells.garden page reached OAuth bridge: ${JSON.stringify(rejected)}`);
    await bridge.close();

    // --- New Tab: plant, add a stem cell, reload, still there. ---
    const newtab = await context.newPage();
    await newtab.setViewportSize({ width: 1280, height: 800 });
    watch(newtab, 'newtab');
    await newtab.goto(`chrome-extension://${extId}/newtab.html`);
    await newtab.waitForSelector('.garden-canvas-viewport');
    assert(await newtab.getAttribute('html', 'data-context') === 'newtab', 'newtab.html must set data-context="newtab"');
    assert(/empty/i.test(await newtab.textContent('.kanban-empty-message h3')), 'a fresh profile should start with an empty garden');

    await newtab.click('.add-column-btn-inner >> nth=1');
    await newtab.waitForSelector('.modal textarea');
    await newtab.fill('.modal textarea', SEED);
    await newtab.keyboard.press('Enter');
    await newtab.waitForSelector('.project-column');
    assert(await newtab.textContent('.seed-content') === SEED, 'the seed text did not land in the column');

    await newtab.click('.stem-zone .zone-add-btn');
    await newtab.waitForSelector('.garden-item.is-draft');
    await newtab.fill('.garden-item.is-draft', STEM);
    await newtab.keyboard.press('Enter');
    await newtab.waitForFunction((t) => [...document.querySelectorAll('.garden-item')].some((el) => el.textContent === t), STEM);
    assert((await newtab.$$('.garden-stem-container > div')).length > 0, 'the plant did not grow a stem part');
    // Wait for the save to land before reloading.
    await newtab.waitForFunction((t) => (localStorage.getItem('cells.garden/v1') ?? '').includes(t), STEM);
    await screenshot(newtab, 'newtab');

    await newtab.reload();
    await newtab.waitForSelector('.project-column');
    assert(await newtab.textContent('.seed-content') === SEED, 'the seed did not survive a reload');
    assert((await newtab.$$eval('.garden-item', (els) => els.map((e) => e.textContent))).includes(STEM), 'the stem cell did not survive a reload');

    // --- Side Panel: same garden at strip width, nothing overflows. ---
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 900 });
    watch(panel, 'sidepanel');
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.waitForSelector('.garden-canvas-viewport');
    assert(await panel.getAttribute('html', 'data-context') === 'sidepanel', 'sidepanel.html must set data-context="sidepanel"');
    await panel.waitForSelector('.project-column');
    assert(await panel.textContent('.seed-content') === SEED, 'the side panel does not show the plant from the new tab page');
    assert((await panel.$$eval('.garden-item', (els) => els.map((e) => e.textContent))).includes(STEM), 'the side panel does not show the stem cell');

    const size = await panel.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        canvas: document.querySelector('.garden-canvas-viewport').getBoundingClientRect().width,
    }));
    assert(size.scrollWidth <= size.clientWidth, `the side panel overflows horizontally: scrollWidth ${size.scrollWidth} > clientWidth ${size.clientWidth}`);
    assert(size.canvas <= 360, `the canvas is wider than the panel: ${size.canvas}`);

    const panelGroundRatio = async () => panel.evaluate(() => {
        const viewport = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const plant = document.querySelector('.garden-plant-wrapper').getBoundingClientRect();
        return (plant.top - viewport.top) / viewport.height;
    });
    let sideGround = await panelGroundRatio();
    assert(sideGround > 0.45 && sideGround < 0.84,
        `side panel opened with the horizon misplaced: ${sideGround}`);

    // Regression for the screenshot bug: a legacy camera can be fully "in view"
    // while its plant horizon sits near the top. Cold open must repair it.
    await panel.evaluate(() => {
        const viewport = document.querySelector('.garden-canvas-viewport');
        const plant = document.querySelector('.garden-plant-wrapper');
        const state = JSON.parse(localStorage.getItem('cells.garden/view/sidepanel') || '{}');
        const viewportRect = viewport.getBoundingClientRect();
        const plantTopWorld = parseFloat(plant.style.top);
        const zoom = typeof state.zoom === 'number' ? state.zoom : 0.34;
        state.translateY = viewportRect.height * 0.20 - plantTopWorld * zoom;
        delete state.groundRatio;
        delete state.viewportHeight;
        localStorage.setItem('cells.garden/view/sidepanel', JSON.stringify(state));
    });
    await panel.reload();
    await panel.waitForSelector('.garden-plant-wrapper');
    await panel.waitForFunction(() => {
        const viewport = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const plant = document.querySelector('.garden-plant-wrapper').getBoundingClientRect();
        const ratio = (plant.top - viewport.top) / viewport.height;
        return ratio > 0.45 && ratio < 0.84;
    });
    sideGround = await panelGroundRatio();
    assert(sideGround > 0.45 && sideGround < 0.84,
        `side panel did not repair a stale high camera: ${sideGround}`);

    // Opening/resizing a narrow sidebar must keep the same vertical composition.
    await panel.setViewportSize({ width: 360, height: 620 });
    await panel.waitForFunction(() => {
        const viewport = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const plant = document.querySelector('.garden-plant-wrapper').getBoundingClientRect();
        const ratio = (plant.top - viewport.top) / viewport.height;
        return ratio > 0.42 && ratio < 0.86;
    });
    const resizedGround = await panelGroundRatio();
    assert(resizedGround > 0.42 && resizedGround < 0.86,
        `side panel resize moved the plants vertically: ${resizedGround}`);
    await panel.setViewportSize({ width: 360, height: 900 });

    // The shared plant-type picker must stay visual and three columns wide in the extension side panel.
    await panel.click('.seed-content', { button: 'right' });
    await panel.waitForSelector('.plant-type-grid');
    const sidePicker = await panel.evaluate(() => {
        const grid = document.querySelector('.plant-type-grid');
        const tiles = [...grid.querySelectorAll('.plant-type-tile')];
        return {
            columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
            tiles: tiles.length,
            withPixelArt: tiles.filter((tile) => tile.querySelector('.plant-type-preview img')).length,
            right: grid.getBoundingClientRect().right,
        };
    });
    assert(sidePicker.columns === 3 && sidePicker.tiles >= 3 && sidePicker.withPixelArt === sidePicker.tiles,
        `side-panel plant picker is not a 3-column pixel-art grid: ${JSON.stringify(sidePicker)}`);
    assert(sidePicker.right <= 360 + 1, `side-panel plant picker overflows: ${JSON.stringify(sidePicker)}`);
    await panel.evaluate(() => document.querySelector('.garden-context-menu')?.remove());

    // Writes from the panel reach the shared storage too.
    await panel.click('.flowers-zone .zone-add-btn');
    await panel.waitForSelector('.garden-item.is-draft');
    const draftBox = await (await panel.$('.garden-item.is-draft')).boundingBox();
    assert(draftBox.x >= 0 && draftBox.x + draftBox.width <= 360, `the new cell does not fit the panel: ${JSON.stringify(draftBox)}`);
    await panel.fill('.garden-item.is-draft', FLOWER);
    await panel.keyboard.press('Enter');
    await panel.waitForFunction((t) => (localStorage.getItem('cells.garden/v1') ?? '').includes(t), FLOWER);
    await screenshot(panel, 'sidepanel');

    await newtab.reload();
    await newtab.waitForSelector('.project-column');
    assert((await newtab.$$eval('.garden-item', (els) => els.map((e) => e.textContent))).includes(FLOWER), 'a cell added in the side panel is missing from the new tab page');

    // --- Popup: one plant at a time, compact controls, optional kanban card. ---
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 440 });
    watch(popup, 'popup');
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.waitForSelector('.garden-canvas-viewport');
    assert(await popup.getAttribute('html', 'data-context') === 'popup', 'popup.html must set data-context="popup"');
    await popup.waitForFunction((seed) => document.querySelector('.popup-label')?.textContent === seed, SEED);
    assert((await popup.$('.popup-name')) === null, 'the popup must not show a separate Plant x/x/name line');
    assert(await popup.getAttribute('.popup-row', 'aria-label') === 'Plant 1 of 1', 'the popup should keep the plant position for accessibility');
    // The camera glides between plants; measure once it has settled.
    const settled = () => popup.waitForFunction(() => !document.querySelector('.garden-world')?.getAnimations().length);
    await settled();
    const popupLayout = await popup.evaluate(() => {
        const hidden = (sel) => { const el = document.querySelector(sel); return !el || getComputedStyle(el).display === 'none'; };
        const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const world = document.querySelector('.garden-world');
        return {
            kanbanHidden: hidden('.garden-bottom-half') && hidden('.garden-resizer') && hidden('.garden-board-toggle'),
            canvas: rect('.garden-canvas-viewport'),
            footer: rect('.popup-footer'),
            transform: world ? world.style.transform : '',
            plant: rect('.garden-plant-wrapper'),
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
        };
    });
    assert(popupLayout.kanbanHidden, 'the popup must hide the kanban, the resizer and the board toggle');
    assert(popupLayout.canvas.height >= 200, `the popup canvas is too small: ${JSON.stringify(popupLayout.canvas)}`);
    assert(popupLayout.footer.y + popupLayout.footer.height <= 440 && popupLayout.scrollWidth <= 320 && popupLayout.scrollHeight <= 440, `the popup overflows its window: ${JSON.stringify(popupLayout)}`);
    assert(/scale\(/.test(popupLayout.transform), `the popup camera was not aimed: transform "${popupLayout.transform}"`);
    // The plant's anchor (its horizon point) must be inside the canvas, roughly centred.
    const anchorX = popupLayout.plant.x - popupLayout.canvas.x;
    assert(anchorX > popupLayout.canvas.width * 0.3 && anchorX < popupLayout.canvas.width * 0.7, `the plant is not centred in the popup: anchor x ${anchorX} of ${popupLayout.canvas.width}`);
    assert(await popup.$eval('.popup-arrow >> nth=0', (b) => b.disabled), 'with one plant the arrows should be disabled');
    // Arrow keys and buttons wrap around; with one plant the seed label does not change.
    await popup.keyboard.press('ArrowRight');
    assert(await popup.textContent('.popup-label') === SEED, 'cycling past the last plant must wrap');
    assert(await popup.textContent('.popup-action >> nth=0') === 'Garden' && await popup.textContent('.popup-action >> nth=1') === 'Side panel', 'the popup must offer Garden and Side panel');

    // The current plant's kanban card is available in a collapsible panel.
    assert(!(await popup.$eval('.popup-kanban', (el) => el.open)), 'the popup kanban should start collapsed');
    await popup.click('.popup-kanban-summary');
    await popup.waitForFunction(() => document.querySelector('.popup-kanban')?.open === true);
    await popup.setViewportSize({ width: 320, height: 560 });
    assert(await popup.textContent('.popup-kanban-body .seed-content') === SEED, 'the popup kanban must show the selected plant');
    assert((await popup.$$eval('.popup-kanban-body .garden-item', (els) => els.map((e) => e.textContent))).includes(STEM), 'the popup kanban must show the selected plant cells');
    await screenshot(popup, 'popup');

    // A second plant added elsewhere updates the accessible position and the card.
    await newtab.click('.add-column-btn-inner >> nth=1');
    await newtab.waitForSelector('.modal textarea');
    await newtab.fill('.modal textarea', SEED_2);
    await newtab.keyboard.press('Enter');
    await newtab.waitForFunction((t) => (localStorage.getItem('cells.garden/v1') ?? '').includes(t), SEED_2);
    await popup.waitForFunction(() => document.querySelector('.popup-row')?.getAttribute('aria-label') === 'Plant 1 of 2', null, { timeout: 5000 });
    await popup.click('.popup-arrow >> nth=1');
    await popup.waitForFunction((seed) => document.querySelector('.popup-label')?.textContent === seed, SEED_2);
    assert(await popup.getAttribute('.popup-row', 'aria-label') === 'Plant 2 of 2', 'the next arrow did not move to the second plant');
    assert(await popup.textContent('.popup-kanban-body .seed-content') === SEED_2, 'the popup kanban did not follow the selected plant');
    await settled();
    const secondAnchor = await popup.evaluate(() => {
        const canvas = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const plants = [...document.querySelectorAll('.garden-plant-wrapper')].map((el) => el.getBoundingClientRect().x - canvas.x);
        return { width: canvas.width, plants };
    });
    assert(secondAnchor.plants[1] > secondAnchor.width * 0.3 && secondAnchor.plants[1] < secondAnchor.width * 0.7, `the second plant is not centred: ${JSON.stringify(secondAnchor)}`);
    assert(await popup.evaluate(() => localStorage.getItem('cells.garden/popup/index')) === '1', 'the popup must remember the plant it shows');
    await screenshot(popup, 'popup-2');

    // --- Sign-in pill: present exactly when the build has Supabase config. ---
    for (const [page, label, width] of [[newtab, 'newtab', 1280], [panel, 'sidepanel', 360]]) {
        if (hasSupabase) {
            await page.waitForSelector('.auth-pill', { timeout: 5000 });
            const pill = await page.$('.auth-pill');
            assert((await pill.textContent()).trim() === 'Sign in', `${label}: the pill should offer sign-in`);
            const box = await pill.boundingBox();
            assert(box.x >= 0 && box.x + box.width <= width, `${label}: the pill sticks out of the viewport: ${JSON.stringify(box)}`);
        } else {
            assert((await page.$('.auth-pill')) === null, `${label}: no pill expected without Supabase config`);
        }
    }

    // Let any late async errors surface before we judge the console.
    await panel.waitForTimeout(500);
} catch (e) {
    failure = e;
} finally {
    if (context) await context.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
}

if (failure) console.error(`test-ext: FAILED: ${failure.stack ?? failure.message}`);
if (errors.length) {
    console.error('test-ext: unexpected console/page errors:');
    for (const e of errors) console.error(`  ${e}`);
}
if (failure || errors.length) process.exit(1);
console.log('test-ext: ok');
