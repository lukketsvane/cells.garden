#!/usr/bin/env node
// End-to-end check of the Chrome extension build in dist-ext/. Builds it when
// it is stale, loads it into Chromium with Playwright, exercises the New Tab
// page and the Side Panel page, and fails on any console error or page error
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

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-ext');
const MANIFEST = join(DIST, 'manifest.json');
const SCREENSHOT_DIR = process.env.EXT_TEST_SCREENSHOTS || '';

const SEED = 'Port the garden to the extension';
const STEM = 'Scaffold + shim';
const FLOWER = 'Side panel works';

// Console / page errors that only mean "no network here" and are ignored.
const NETWORK_FAILURE = [/ERR_TUNNEL_CONNECTION_FAILED/, /Failed to fetch/, /Failed to load resource/];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

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
assert(JSON.stringify(manifest.permissions) === JSON.stringify(['sidePanel']), `permissions must be exactly ["sidePanel"], got ${JSON.stringify(manifest.permissions)}`);
assert(!('host_permissions' in manifest), 'host_permissions must not be set');
assert(!('optional_permissions' in manifest), 'optional_permissions must not be set');
assert(manifest.background?.service_worker === 'background.js' && manifest.background?.type === 'module', 'background must be the module service worker background.js');
assert(existsSync(join(DIST, 'background.js')), 'dist-ext/background.js is missing');
assert(manifest.chrome_url_overrides?.newtab === 'newtab.html', 'chrome_url_overrides.newtab must be newtab.html');
assert(manifest.side_panel?.default_path === 'sidepanel.html', 'side_panel.default_path must be sidepanel.html');
assert(manifest.minimum_chrome_version === '114', 'minimum_chrome_version must be 114');
for (const size of [16, 32, 48, 128]) {
    assert(existsSync(join(DIST, manifest.icons?.[size] ?? '')), `icons.${size} must point at a file in dist-ext/`);
    assert(existsSync(join(DIST, manifest.action?.default_icon?.[size] ?? '')), `action.default_icon.${size} must point at a file in dist-ext/`);
}
for (const page of ['newtab.html', 'sidepanel.html']) {
    const html = readFileSync(join(DIST, page), 'utf8');
    // MV3's content security policy forbids inline scripts on extension pages.
    assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), `${page} contains an inline <script>`);
    assert(/<script\b[^>]*\bsrc="\.\/assets\//.test(html), `${page} does not load its module from ./assets/`);
}

// Sign-in is only part of the build when it carries Supabase config, and the
// manifest then also opens newtab.html to the auth server for the magic link.
const supabaseUrl = readSupabaseUrl();
const hasSupabase = supabaseUrl !== '';
if (hasSupabase) {
    const war = manifest.web_accessible_resources;
    assert(Array.isArray(war) && war.length === 1, 'web_accessible_resources must have exactly one entry when Supabase is configured');
    assert(JSON.stringify(war[0].resources) === JSON.stringify(['newtab.html']), 'web_accessible_resources must expose newtab.html only');
    assert(JSON.stringify(war[0].matches) === JSON.stringify([`${new URL(supabaseUrl).origin}/*`]), `web_accessible_resources must match the Supabase origin, got ${JSON.stringify(war[0].matches)}`);
} else {
    assert(!('web_accessible_resources' in manifest), 'web_accessible_resources must be absent without Supabase config');
}
console.log(`test-ext: manifest ok (version ${manifest.version}, supabase ${hasSupabase ? 'configured' : 'not configured'})`);

function readSupabaseUrl() {
    // Same precedence as the Vite config: real environment, then .env files
    // from the repo root, VITE_ prefix optional.
    for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
        if (process.env[name]) return process.env[name].trim();
    }
    for (const file of ['.env.local', '.env']) {
        const path = join(ROOT, file);
        if (!existsSync(path)) continue;
        for (const line of readFileSync(path, 'utf8').split('\n')) {
            const match = line.match(/^\s*(?:VITE_)?SUPABASE_URL\s*=\s*"?([^"#\s]+)"?/);
            if (match) return match[1].trim();
        }
    }
    return '';
}

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

    // The toolbar icon opens the side panel. The worker sets this at startup,
    // so give it a moment.
    let behavior = null;
    for (let i = 0; i < 20 && behavior?.openPanelOnActionClick !== true; i++) {
        behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
        if (behavior?.openPanelOnActionClick !== true) await new Promise((r) => setTimeout(r, 100));
    }
    assert(behavior?.openPanelOnActionClick === true, `openPanelOnActionClick is not set: ${JSON.stringify(behavior)}`);

    // --- New Tab: plant, add a stem cell, reload, still there. ---
    const newtab = await context.newPage();
    await newtab.setViewportSize({ width: 1280, height: 800 });
    watch(newtab, 'newtab');
    await newtab.goto(`chrome-extension://${extId}/newtab.html`);
    await newtab.waitForSelector('.garden-canvas-viewport');
    assert(await newtab.getAttribute('html', 'data-context') === 'newtab', 'newtab.html must set data-context="newtab"');
    assert((await newtab.textContent('.kanban-empty-message h3')).includes('Empty'), 'a fresh profile should start with an empty garden');

    await newtab.click('.add-column-btn-inner >> nth=1');
    await newtab.waitForSelector('.modal textarea');
    await newtab.fill('.modal textarea', SEED);
    await newtab.keyboard.press('Enter');
    await newtab.waitForSelector('.project-column');
    assert(await newtab.textContent('.seed-content') === SEED, 'the seed text did not land in the column');

    await newtab.click('.stem-zone .zone-add-btn');
    await newtab.waitForSelector('.modal input[type=text]');
    await newtab.fill('.modal input[type=text]', STEM);
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

    // Writes from the panel reach the shared storage too.
    await panel.click('.flowers-zone .zone-add-btn');
    await panel.waitForSelector('.modal input[type=text]');
    const modal = await panel.$('.modal');
    const modalBox = await modal.boundingBox();
    assert(modalBox.x >= 0 && modalBox.x + modalBox.width <= 360, `the modal does not fit the panel: ${JSON.stringify(modalBox)}`);
    await panel.fill('.modal input[type=text]', FLOWER);
    await panel.keyboard.press('Enter');
    await panel.waitForFunction((t) => (localStorage.getItem('cells.garden/v1') ?? '').includes(t), FLOWER);
    await screenshot(panel, 'sidepanel');

    await newtab.reload();
    await newtab.waitForSelector('.project-column');
    assert((await newtab.$$eval('.garden-item', (els) => els.map((e) => e.textContent))).includes(FLOWER), 'a cell added in the side panel is missing from the new tab page');

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
