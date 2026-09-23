#!/usr/bin/env node
// Browser smoke test for the web build plus the PWA. Run with "npm run test:web".
//
// Starts "vite preview" on port 4173 (TEST_WEB_PORT overrides it, so two
// checkouts can test at once) against dist/ (building first when dist/
// is missing) and drives the garden with Playwright: plants seeds, adds cells
// to every zone, context menus, pan/zoom, reload persistence, a mobile
// viewport with pan view. Then the PWA: the manifest and sw.js are served, the service
// worker takes control of the page, and the garden still renders offline.
//
// Console errors that are exactly network failures to Supabase/Google are
// tolerated (a sandbox may block those hosts; the app copes). Any other
// console error or page error fails the run. Set SCREENSHOTS=<dir> to save
// screenshots along the way.

import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_WEB_PORT) || 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const SHOTS = process.env.SCREENSHOTS || '';
const ICONS = ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
// The plant types in the pack, found the way assets.ts finds them: a folder with stem/ or flowers/ in it.
const PACK = join(ROOT, 'src', 'assets', 'pack');
const PLANT_TYPES = readdirSync(PACK, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (existsSync(join(PACK, d.name, 'stem')) || existsSync(join(PACK, d.name, 'flowers'))))
    .map((d) => d.name)
    .sort();

// Hosts the app talks to that a sandbox may block; failures to them are noise.
const BLOCKED_HOSTS = /supabase\.co|google\.com/;
const NETWORK_FAILURE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to fetch|Failed to load resource/;

function isBlockedNetworkNoise(text, url = '') {
    if (!NETWORK_FAILURE.test(text)) return false;
    if (BLOCKED_HOSTS.test(url) || BLOCKED_HOSTS.test(text)) return true;
    // "TypeError: Failed to fetch" carries no URL; only the Supabase client uses fetch() here.
    return /Failed to fetch/.test(text) && !/localhost|127\.0\.0\.1/.test(text);
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

// The zone icons are pixel art: crisp edges, no stroke, and a whole number of
// CSS pixels to each art pixel, so no pixel is smeared across two.
async function checkZoneIcons(page, label) {
    const icons = await page.$$eval('.zone-icon svg', (els) => els.map((svg) => {
        const rect = svg.getBoundingClientRect();
        const grid = svg.viewBox.baseVal;
        return {
            zone: svg.closest('.garden-zone')?.classList[1],
            shape: getComputedStyle(svg).shapeRendering,
            stroked: [svg, ...svg.querySelectorAll('*')].some((el) => getComputedStyle(el).stroke !== 'none'),
            grid: `${grid.width}x${grid.height}`,
            scaleX: rect.width / grid.width,
            scaleY: rect.height / grid.height,
        };
    }));
    const zones = new Set(icons.map((icon) => icon.zone));
    assert(['flowers-zone', 'stem-zone', 'roots-zone', 'minerals-zone'].every((z) => zones.has(z)), `${label}: a zone lost its icon: ${JSON.stringify(icons)}`);
    for (const icon of icons) {
        assert(/^crispedges$/i.test(icon.shape), `${label}: a zone icon is smoothed: ${JSON.stringify(icon)}`);
        assert(!icon.stroked, `${label}: a zone icon is stroked, not built from pixels: ${JSON.stringify(icon)}`);
        assert(Number.isInteger(icon.scaleX) && icon.scaleX >= 1 && icon.scaleX === icon.scaleY,
            `${label}: a zone icon is not a whole number of CSS pixels per art pixel: ${JSON.stringify(icon)}`);
    }
    console.log(`${label} zone icons:`, [...new Set(icons.map((icon) => `${icon.grid} at ${icon.scaleX}x`))].join(', '));
}

// ---------------------------------------------------------------------------
// Build + preview server
// ---------------------------------------------------------------------------

function ensureBuild() {
    if (existsSync(join(ROOT, 'dist', 'index.html'))) return;
    console.log('dist/index.html missing, running "npm run build:web" first');
    execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });
}

async function startPreview() {
    const child = spawn(process.execPath, [VITE, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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
        // Vite colors its startup banner, so matching raw stdout is brittle.
        // --strictPort guarantees another process cannot silently steal the port;
        // poll the actual loopback endpoint instead.
        try {
            const res = await fetch(BASE);
            if (res.ok) return child;
        } catch {
            // Not listening yet.
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

    const groundRatio = async (p) => p.evaluate(() => {
        const viewport = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const plant = document.querySelector('.garden-plant-wrapper').getBoundingClientRect();
        return (plant.top - viewport.top) / viewport.height;
    });
    const desktopGround = await groundRatio(page);
    assert(desktopGround > 0.45 && desktopGround < 0.84,
        `desktop garden opened with the horizon misplaced: ${desktopGround}`);
    // Pan view is for fingers: a mouse pans the garden in place.
    assert(!(await page.isVisible('.garden-pan-toggle')), 'the pan view button should not show on a desktop');

    // Add items to each zone
    const zones = [
        ['flowers-zone', 'Runs in browser'],
        ['stem-zone', 'Scaffold + shim'],
        ['roots-zone', 'Friends can use it without Obsidian'],
        ['minerals-zone', 'Supabase sync'],
    ];
    for (const [zone, text] of zones) {
        await page.click(`.${zone} .zone-add-btn`);
        await page.waitForSelector('.garden-item.is-draft');
        await page.fill('.garden-item.is-draft', text);
        await page.keyboard.press('Enter');
        await page.waitForFunction((t) => [...document.querySelectorAll('.garden-item')].some((el) => el.textContent === t), text);
    }
    await page.waitForTimeout(600);
    const items = await page.$$eval('.garden-item', (els) => els.map((e) => e.textContent));
    console.log('items:', items);
    assert(items.length === zones.length, `expected ${zones.length} items, got ${items.length}`);
    console.log('plant parts:', await page.$$eval('.garden-stem-container > div', (els) => els.map((e) => e.className)));
    await checkZoneIcons(page, 'desktop');
    await shot(page, '02-one-plant.png');

    // Second plant on the left
    await page.click('.add-column-btn-inner >> nth=0');
    await page.fill('.modal textarea', 'Second plant');
    await page.click('.modal button.mod-cta');
    await page.waitForFunction(() => document.querySelectorAll('.project-column').length === 2);
    console.log('columns:', await page.$$eval('.seed-content', (els) => els.map((e) => e.textContent)));

    // A kanban column is an abstract plant: the seed is one shared horizon,
    // blocks above it stay packed upward, blocks below stay packed downward.
    const kanbanHorizon = await page.evaluate(() => {
        const columns = [...document.querySelectorAll('.kanban-scroll-container > .project-column')];
        const seeds = columns.map((column) => column.querySelector('.seed-cell').getBoundingClientRect());
        const pluses = [...document.querySelectorAll('.kanban-scroll-container > .add-column-btn .add-column-btn-inner')]
            .map((el) => el.getBoundingClientRect());
        const seedTop = seeds.map((r) => r.top);
        const seedMid = seeds.reduce((sum, r) => sum + r.top + r.height / 2, 0) / Math.max(1, seeds.length);
        const topStacks = columns.map((column) => {
            const top = column.querySelector('.column-top-half');
            const zones = [...top.children];
            const rect = top.getBoundingClientRect();
            const zoneHeight = zones.reduce((sum, zone) => sum + zone.getBoundingClientRect().height, 0);
            return {
                height: rect.height,
                zoneHeight,
                extra: rect.height - zoneHeight,
                marginTop: parseFloat(getComputedStyle(column).marginTop) || 0,
            };
        });
        return {
            seedTop,
            seedSpread: Math.max(...seedTop) - Math.min(...seedTop),
            plusMid: pluses.map((r) => r.top + r.height / 2),
            seedMid,
            topStacks,
        };
    });
    console.log('kanban seed horizon:', kanbanHorizon);
    assert(kanbanHorizon.seedSpread <= 1.5, `seed rows drifted apart: ${JSON.stringify(kanbanHorizon)}`);
    assert(kanbanHorizon.plusMid.every((y) => Math.abs(y - kanbanHorizon.seedMid) <= 2), `add-plant controls are not aligned with seeds: ${JSON.stringify(kanbanHorizon)}`);
    assert(kanbanHorizon.topStacks.every((s) => Math.abs(s.extra) <= 1.5), `above-ground blocks contain floating gaps: ${JSON.stringify(kanbanHorizon)}`);

    // Context menu on a cell -> highlight
    await page.click('.garden-item >> nth=0', { button: 'right' });
    await page.waitForSelector('.garden-context-menu');
    console.log('cell menu:', await page.$$eval('.garden-context-menu button', (els) => els.map((e) => e.textContent)));
    await page.click('.garden-context-menu button:has-text("Highlight")');
    await page.waitForTimeout(300);

    // The plant's menu: Plant type, Seed and Plant hue open their lists in the menu itself.
    const plantId = await page.$eval('.seed-content >> nth=1', (el) => el.dataset.id);
    const stored = (id) => page.evaluate((pid) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === pid), id);
    const menuRow = (label) => `.garden-context-menu > .garden-menu-item:has-text("${label}")`;
    const openPlantMenu = async () => {
        await page.click('.seed-content >> nth=1', { button: 'right' });
        await page.waitForSelector('.garden-context-menu');
    };
    // Choosing redraws the whole garden; wait for the replacement to be attached and measurable.
    const settled = () => page.waitForFunction(() => {
        const viewport = document.querySelector('.garden-canvas-viewport');
        return viewport?.isConnected && viewport.getBoundingClientRect().width > 0;
    });
    // What an open panel holds, measured against its row and the menu.
    const openPanel = (label) => page.evaluate((text) => {
        const menu = document.querySelector('.garden-context-menu');
        const row = [...menu.querySelectorAll(':scope > .garden-menu-item')].find((el) => el.querySelector('.garden-menu-label').textContent === text);
        const panel = document.getElementById(row.getAttribute('aria-controls'));
        const options = [...panel.querySelectorAll('.garden-menu-item')];
        const rect = menu.getBoundingClientRect();
        return {
            expanded: row.getAttribute('aria-expanded'),
            open: panel.classList.contains('is-open'),
            openPanels: menu.querySelectorAll('.garden-menu-panel.is-open').length,
            sub: row.querySelector('.garden-menu-sub')?.textContent ?? null,
            underRow: row.nextElementSibling === panel,
            asWideAsMenu: Math.abs(panel.getBoundingClientRect().width - menu.clientWidth) <= 1,
            inView: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            scrolls: panel.scrollHeight > panel.clientHeight,
            active: options.filter((o) => o.classList.contains('is-active')).map((o) => o.dataset.plantType ?? o.dataset.seed),
            types: options.map((o) => o.dataset.plantType).filter(Boolean),
            seeds: options.map((o) => o.dataset.seed).filter(Boolean),
        };
    }, label);

    await openPlantMenu();
    const plantMenu = await page.$$eval('.garden-context-menu > .garden-menu-item .garden-menu-label', (els) => els.map((e) => e.textContent));
    console.log('plant menu:', plantMenu);
    assert.deepEqual(plantMenu, ['Standby', 'Plant type', 'Seed', 'Plant hue', 'Recycle plant']);

    // Plant type: every type, one stem each, the very sprite the plant's first stem becomes.
    await page.click(menuRow('Plant type'));
    const types = await openPanel('Plant type');
    console.log('plant type panel:', types);
    assert(types.expanded === 'true' && types.open && types.openPanels === 1 && types.underRow, `the type list should open under its row: ${JSON.stringify(types)}`);
    assert(types.asWideAsMenu && types.inView, `the type list must be as wide as the menu and on screen: ${JSON.stringify(types)}`);
    assert.deepEqual(types.types, PLANT_TYPES, 'the type list must hold every plant type in the pack');
    assert(types.active.length === 1, `exactly one type is the current one: ${JSON.stringify(types.active)}`);
    const stemsTrue = await page.evaluate(() => [...document.querySelectorAll('.garden-menu-panel.is-open .garden-menu-item')].every((row) => {
        const assets = window.garden.assetManager;
        const imgs = row.querySelectorAll('img');
        const path = assets.getPlantTypeImagePath('stem', row.dataset.plantType, 0);
        return imgs.length === 1 && imgs[0].dataset.path === path && imgs[0].getAttribute('src') === assets.getImageUrlSync(path)
            && getComputedStyle(imgs[0]).imageRendering !== 'auto';
    }));
    assert(stemsTrue, 'each type must show exactly one crisp stem: the first stem that type gives a plant');
    await shot(page, '02b-plant-type-menu.png');
    const typeChoice = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.garden-menu-panel.is-open .garden-menu-item')].find((el) => !el.classList.contains('is-active'));
        return { type: row.dataset.plantType, stem: row.querySelector('img').dataset.path };
    });
    await page.click(`.garden-menu-panel.is-open .garden-menu-item[data-plant-type="${typeChoice.type}"]`);
    await page.waitForFunction(({ id, type }) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === id).plantType === type, { id: plantId, type: typeChoice.type });
    assert(await page.$('.garden-context-menu') === null, 'choosing a type should close the menu');
    assert((await stored(plantId)).stem[0].imagePath === typeChoice.stem, 'the plant took another stem than the menu showed');
    await settled();

    // Seed: the 27 icons in number order; choosing one plants seeds/seed<n>.png, which the garden draws.
    await openPlantMenu();
    await page.click(menuRow('Plant type'));
    await page.click(menuRow('Seed'));
    const seeds = await openPanel('Seed');
    console.log('seed panel:', { ...seeds, seeds: seeds.seeds.length });
    assert(seeds.open && seeds.openPanels === 1 && seeds.asWideAsMenu && seeds.inView && seeds.scrolls, `the seed list should replace the type list and scroll inside the menu: ${JSON.stringify(seeds)}`);
    assert.deepEqual(seeds.seeds, Array.from({ length: 27 }, (_, i) => `seeds/seed${i + 1}.png`));
    assert(await page.$$eval('.garden-menu-panel.is-open .garden-menu-seed-icon', (els) => els.length) === 27, 'every seed shows its icon');
    const seedChoice = seeds.seeds.find((path) => !seeds.active.includes(path));
    await page.click(`.garden-menu-panel.is-open .garden-menu-item[data-seed="${seedChoice}"]`);
    await page.waitForFunction(({ id, path }) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === id).seedImagePath === path, { id: plantId, path: seedChoice });
    assert(await page.$('.garden-context-menu') === null, 'choosing a seed should close the menu');
    await page.waitForFunction(({ id, path }) => {
        const part = [...document.querySelectorAll('.garden-plant-wrapper')].find((w) => w.dataset.projectId === id)?.querySelector('.garden-seed-part');
        return part?.style.backgroundImage.includes(window.garden.assetManager.getImageUrlSync(path));
    }, { id: plantId, path: seedChoice });
    await settled();

    // Plant hue: the garden and the board follow every keystroke without being drawn again.
    const hueTargets = () => page.evaluate((id) => {
        const sprite = [...document.querySelectorAll('.garden-plant-wrapper')].find((w) => w.dataset.projectId === id).querySelector('.garden-stem-container');
        const seed = [...document.querySelectorAll('.kanban-scroll-container .project-column')].find((c) => c.dataset.projectId === id).querySelector('.seed-content');
        window.__hueSprite ??= sprite;
        return { sprite: sprite.style.filter, seed: seed.style.filter, same: window.__hueSprite === sprite };
    }, plantId);
    await openPlantMenu();
    await hueTargets();
    await page.click(menuRow('Plant hue'));
    assert(await page.evaluate(() => document.activeElement?.classList.contains('garden-menu-hue-field')), 'the hue field should take the focus');
    await page.fill('.garden-menu-hue-field', '200');
    let hue = await hueTargets();
    console.log('hue preview:', hue);
    assert(hue.sprite === 'hue-rotate(200deg)' && hue.seed === 'hue-rotate(200deg)' && hue.same, `the hue should show live on the plant and its card: ${JSON.stringify(hue)}`);
    assert((await openPanel('Plant hue')).sub === '200°', 'the row shows the hue being picked');
    assert(await page.$eval('.garden-menu-hue-slider', (el) => el.value) === '200', 'the slider follows the field');
    await shot(page, '02c-plant-hue.png');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === id).hue === 200, plantId);
    assert(await page.$('.garden-context-menu') === null, 'Enter keeps the hue and closes the menu');
    // Past the end a number is held there; the arrows go round; Escape puts the hue back.
    await openPlantMenu();
    await page.click(menuRow('Plant hue'));
    await page.fill('.garden-menu-hue-field', '400');
    assert(await page.$eval('.garden-menu-hue-field', (el) => el.value) === '359', 'a hue past 359 is held at 359');
    await page.keyboard.press('ArrowUp');
    assert(await page.$eval('.garden-menu-hue-field', (el) => el.value) === '0', 'up from 359 goes round to 0');
    assert((await hueTargets()).sprite === 'hue-rotate(0deg)', 'the arrows preview too');
    await page.keyboard.press('Escape');
    hue = await hueTargets();
    assert(await page.$('.garden-context-menu') === null && hue.sprite === 'hue-rotate(200deg)' && hue.seed === 'hue-rotate(200deg)',
        `Escape should put the hue back: ${JSON.stringify(hue)}`);
    assert((await stored(plantId)).hue === 200, 'Escape must not keep the previewed hue');

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

    // Items and pets wait for Max's approval, so this build shows neither, not
    // even for a garden that holds them (one used on dev.cells.garden), and it
    // keeps them in the garden untouched.
    const held = await page.evaluate(() => {
        const garden = JSON.parse(localStorage.getItem('cells.garden/v1'));
        garden.settings.petCrow = true;
        garden.settings.items = [{ id: 'gnome_test', kind: 'gnome', x: 0.5 }, { id: 'lamp_test', kind: 'lamp', x: 1 }];
        localStorage.setItem('cells.garden/v1', JSON.stringify(garden));
        return garden.settings.items;
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.project-column');
    await page.waitForTimeout(400);
    const extras = await page.$$eval('.garden-items-layer, .garden-pets-layer, .garden-scene-item, .garden-pet', (els) => els.map((e) => e.className));
    assert(extras.length === 0, `items or pets drawn in a build without them: ${JSON.stringify(extras)}`);
    if (await page.$('.auth-pill')) {
        await page.click('.auth-pill');
        await page.waitForSelector('.garden-context-menu');
        const pill = await page.$$eval('.garden-context-menu .garden-menu-label', (els) => els.map((e) => e.textContent));
        assert(!pill.includes('Items') && pill.includes('Pets'), `the pill menu offers Items, or lost Pets: ${JSON.stringify(pill)}`);
        await page.click('.garden-context-menu .garden-menu-item:has(.garden-menu-label:text-is("Pets"))');
        await page.waitForSelector('.modal .garden-tile');
        const tiles = await page.$$eval('.modal .garden-tile', (els) => els.map((e) => [e.getAttribute('aria-label'), e.disabled]));
        console.log('pets without extras:', tiles);
        assert.deepEqual(tiles, [['Garden gnome, unavailable', true], ['Pumpkin, unavailable', true], ['Crow, unavailable', true]],
            'the Pets menu shows what is coming, greyed out');
        await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.garden.saveGardenData());
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/v1')).settings);
    assert.deepEqual(kept.items, held, 'a build without items must keep the ones a garden holds');
    assert(kept.petCrow === true, 'a build without pets must keep their switches');

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

    // Invite link, signed out: the token leaves the address, waits in storage, and
    // sign-in is asked for with a note. (Only when the build carries Supabase config.)
    {
        const ictx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const ipage = await ictx.newPage();
        watchErrors(ipage, 'invite', errors);
        const token = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';
        await ipage.goto(`${BASE}#join=${token}`, { waitUntil: 'networkidle' });
        await ipage.waitForSelector('.garden-canvas-viewport');
        const hasPill = (await ipage.$('.auth-pill')) !== null;
        assert(!ipage.url().includes('#join='), `the invite token must leave the address bar: ${ipage.url()}`);
        const pending = await ipage.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/v1/pendingJoin') || 'null'));
        if (hasPill) {
            assert(pending && pending.token === token, `the invite should wait for sign-in: ${JSON.stringify(pending)}`);
            await ipage.waitForSelector('.modal .auth-note', { timeout: 5000 });
            console.log('invite note:', await ipage.textContent('.modal .auth-note'));
        } else {
            assert(pending === null, 'without Supabase config the invite is dropped');
        }
        // A plant link waits the same way, marked as a plant.
        await ipage.evaluate(() => localStorage.removeItem('cells.garden/v1/pendingJoin'));
        await ipage.goto('about:blank');
        await ipage.goto(`${BASE}#plant=${token}`, { waitUntil: 'networkidle' });
        assert(!ipage.url().includes('#plant='), `the plant token must leave the address bar: ${ipage.url()}`);
        const pendingPlant = await ipage.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/v1/pendingJoin') || 'null'));
        if (hasPill) {
            assert(pendingPlant && pendingPlant.token === token && pendingPlant.kind === 'plant', `the plant invite should wait for sign-in: ${JSON.stringify(pendingPlant)}`);
            await ipage.waitForSelector('.modal .auth-note', { timeout: 5000 });
        }
        // A malformed token is ignored and stays in the address.
        await ipage.goto(`${BASE}#join=nope`, { waitUntil: 'networkidle' });
        assert(ipage.url().endsWith('#join=nope'), 'a malformed token must be left alone');
        await ictx.close();
    }

    // iPhone: real touch input through the browser protocol.
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
    const mpage = await mctx.newPage();
    watchErrors(mpage, 'mobile', errors);
    await mpage.goto(BASE, { waitUntil: 'networkidle' });
    await mpage.waitForSelector('.garden-canvas-viewport');
    const cdp = await mctx.newCDPSession(mpage);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    // A re-render swaps the garden in whole, so an element found a moment ago can be
    // gone by the time it is measured: look again until it holds still.
    const center = async (sel) => {
        for (let attempt = 0; attempt < 40; attempt++) {
            const el = await mpage.$(sel);
            const b = el ? await el.boundingBox() : null;
            if (b) return [b.x + b.width / 2, b.y + b.height / 2];
            await mpage.waitForTimeout(50);
        }
        throw new Error(`${sel} never settled on screen`);
    };
    const tapAt = async (sel) => {
        const [x, y] = await center(sel);
        await touch('touchStart', x, y);
        await touch('touchEnd', x, y);
        await mpage.waitForTimeout(120);
    };
    const holdAt = async (sel, ms = 600) => {
        const [x, y] = await center(sel);
        await touch('touchStart', x, y);
        await mpage.waitForTimeout(ms);
        await touch('touchEnd', x, y);
        await mpage.waitForTimeout(150);
    };

    // The page never scrolls sideways; controls sit inside the screen.
    const shell = await mpage.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        files: document.querySelector('.garden-board-toggle').getBoundingClientRect().toJSON(),
        touchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
        viewport: document.querySelector('meta[name="viewport"]').content,
    }));
    console.log('mobile shell:', shell);
    assert(shell.scrollW <= 390, `the page scrolls sideways on a phone: ${shell.scrollW}`);
    assert(shell.files.right <= 390 && shell.files.top >= 0, 'the board toggle is off screen');
    assert(/icon-180\.png$/.test(shell.touchIcon), `iOS needs a PNG touch icon: ${shell.touchIcon}`);
    assert(/viewport-fit=cover/.test(shell.viewport), 'viewport-fit=cover is missing');
    assert((await fetch(new URL('icon-180.png', BASE))).ok, 'icon-180.png is not served');

    // Plant a seed and two stem cells through Max's modals.
    await tapAt('.add-column-btn-inner >> nth=1');
    await mpage.waitForSelector('.modal textarea');
    const modalFont = await mpage.$eval('.modal textarea', (el) => parseFloat(getComputedStyle(el).fontSize));
    assert(modalFont >= 16, `iOS zooms into a field under 16px; the seed field is ${modalFont}px`);
    await mpage.fill('.modal textarea', 'Phone plant');
    await mpage.keyboard.press('Enter');
    await mpage.waitForSelector('.project-column');
    await mpage.waitForFunction(() => document.querySelector('.garden-plant-wrapper')?.getBoundingClientRect().height >= 0);
    const mobileGround = await mpage.evaluate(() => {
        const viewport = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const plant = document.querySelector('.garden-plant-wrapper').getBoundingClientRect();
        return (plant.top - viewport.top) / viewport.height;
    });
    assert(mobileGround > 0.45 && mobileGround < 0.84,
        `mobile garden opened with the horizon misplaced: ${mobileGround}`);

    for (const text of ['First stem', 'Second stem']) {
        await tapAt('.stem-zone .zone-add-btn');
        await mpage.waitForSelector('.garden-item.is-draft');
        await mpage.fill('.garden-item.is-draft', text);
        await mpage.keyboard.press('Enter');
        await mpage.waitForFunction((t) => [...document.querySelectorAll('.garden-item')].some((el) => el.textContent === t), text);
    }
    await checkZoneIcons(mpage, 'mobile');

    // A card per plant on the board, a line between plants.
    const surface = await mpage.evaluate(() => {
        const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
        const col = getComputedStyle(document.querySelector('.project-column'));
        return { card: bg('.flowers-zone'), seed: bg('.seed-cell'), colBorder: col.borderRightWidth, board: bg('.kanban-scroll-container') };
    });
    console.log('board surface:', surface);
    assert(surface.card !== surface.board, `the plants should be cards on the board: ${JSON.stringify(surface)}`);
    assert(surface.colBorder === '1px', 'a line should run between plants');

    const mobileBoardLayout = await mpage.evaluate(() => {
        const board = document.querySelector('.kanban-scroll-container');
        const column = document.querySelector('.project-column');
        const app = document.querySelector('#app');
        const boardStyle = getComputedStyle(board);
        return {
            columnDisplay: getComputedStyle(column).display,
            boardPaddingBottom: parseFloat(boardStyle.paddingBottom),
            appPaddingBottom: parseFloat(getComputedStyle(app).paddingBottom),
            boardBottom: board.getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight,
        };
    });
    console.log('mobile board layout:', mobileBoardLayout);
    assert(mobileBoardLayout.columnDisplay === 'flex', 'plant cards should use the compact stacked kanban layout');
    assert(mobileBoardLayout.boardPaddingBottom >= 16, `the board needs bottom scroll clearance: ${JSON.stringify(mobileBoardLayout)}`);
    assert(mobileBoardLayout.appPaddingBottom === 0, `the PWA shell must not clip itself above the home indicator: ${JSON.stringify(mobileBoardLayout)}`);
    assert(mobileBoardLayout.boardBottom <= mobileBoardLayout.viewportHeight + 1, `the board is cut off below the mobile viewport: ${JSON.stringify(mobileBoardLayout)}`);

    // Tapping a rendered plant part on iPhone must focus its exact board cell.
    // The canvas prevents the native touch default, so this specifically guards the
    // direct touch-end path rather than a synthetic click.
    const plantPartTap = await mpage.evaluate(() => {
        for (const part of document.querySelectorAll('.garden-part[data-item-id]')) {
            const rect = part.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y)?.closest('.garden-part[data-item-id]');
            if (hit?.dataset.itemId) return { x, y, itemId: hit.dataset.itemId };
        }
        return null;
    });
    assert(plantPartTap, 'no tappable plant part was found on mobile');
    await touch('touchStart', plantPartTap.x, plantPartTap.y);
    await touch('touchEnd', plantPartTap.x, plantPartTap.y);
    await mpage.waitForTimeout(180);
    const focusedPartCell = await mpage.evaluate((itemId) => {
        const cell = [...document.querySelectorAll('.kanban-scroll-container .garden-item, .kanban-scroll-container .seed-content')]
            .find((el) => el.dataset.id === itemId);
        if (!cell) return null;
        const rect = cell.getBoundingClientRect();
        const board = document.querySelector('.kanban-scroll-container').getBoundingClientRect();
        return {
            focused: cell.classList.contains('is-focus-highlighted'),
            flashed: cell.classList.contains('is-click-flash'),
            visible: rect.bottom > board.top && rect.top < board.bottom && rect.right > board.left && rect.left < board.right,
        };
    }, plantPartTap.itemId);
    console.log('mobile plant-part focus:', plantPartTap.itemId, focusedPartCell);
    assert(focusedPartCell?.focused && focusedPartCell?.flashed, `tapping a plant part did not highlight its board cell: ${JSON.stringify(focusedPartCell)}`);
    assert(focusedPartCell.visible, 'tapping a plant part did not bring its board cell into view');

    // Tap selects, a second tap edits, at 16px so iOS does not zoom.
    await tapAt('.garden-item >> nth=0');
    await mpage.waitForSelector('.garden-item.is-selected');
    await tapAt('.garden-item.is-selected');
    await mpage.waitForSelector('.garden-item.is-editing');
    const editFont = await mpage.$eval('.garden-item.is-editing', (el) => parseFloat(getComputedStyle(el).fontSize));
    assert(editFont >= 16, `the cell being edited is ${editFont}px; iOS would zoom`);
    await mpage.keyboard.press('End');
    await mpage.keyboard.type(' edited');
    await mpage.keyboard.press('Enter');
    await mpage.waitForFunction(() => [...document.querySelectorAll('.garden-item')].some((el) => el.textContent.endsWith(' edited')));

    // Hold and let go: Max's cell menu.
    await holdAt('.garden-item >> nth=1');
    await mpage.waitForSelector('.garden-context-menu', { timeout: 3000 });
    const menu = await mpage.$$eval('.garden-context-menu button', (els) => els.map((e) => e.textContent));
    console.log('long-press menu:', menu);
    assert(menu.some((t) => /highlight/i.test(t)), 'holding a cell should open its menu');
    await mpage.evaluate(() => document.querySelector('.garden-context-menu')?.remove());

    // Hold the seed: the plant's menu. Its lists open by tap, one at a time, and stay on the phone's screen.
    await holdAt('.seed-content');
    await mpage.waitForSelector('.garden-context-menu', { timeout: 3000 });
    const seedMenu = await mpage.$$eval('.garden-context-menu > .garden-menu-item', (els) => els.map((e) => e.textContent));
    assert(seedMenu.some((t) => /standby|wake/i.test(t)), `holding the seed should open the seed menu: ${JSON.stringify(seedMenu)}`);
    const phonePanel = () => mpage.evaluate(() => {
        const menu = document.querySelector('.garden-context-menu');
        const rect = menu.getBoundingClientRect();
        const open = [...menu.querySelectorAll('.garden-menu-panel.is-open')];
        return {
            open: open.map((p) => menu.querySelector(`[aria-controls="${p.id}"] .garden-menu-label`).textContent),
            expanded: [...menu.querySelectorAll('[aria-expanded="true"] .garden-menu-label')].map((l) => l.textContent),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            inView: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            scrolls: open[0] ? open[0].scrollHeight > open[0].clientHeight : false,
            fieldFont: parseFloat(getComputedStyle(menu.querySelector('.garden-menu-hue-field')).fontSize),
        };
    });
    for (const label of ['Plant type', 'Seed', 'Plant hue']) {
        await tapAt(`.garden-context-menu > .garden-menu-item:has-text("${label}")`);
        const state = await phonePanel();
        console.log('phone panel:', label, state);
        assert(state.open.length === 1 && state.open[0] === label && state.expanded.join() === label, `tapping ${label} should open its list alone: ${JSON.stringify(state)}`);
        assert(state.inView, `the menu with ${label} open leaves the phone's screen: ${JSON.stringify(state)}`);
        if (label === 'Seed') assert(state.scrolls, 'the seed list should scroll inside the menu');
    }
    assert((await phonePanel()).fieldFont >= 16, 'iOS zooms into a hue field under 16px');
    await tapAt('.garden-context-menu > .garden-menu-item:has-text("Plant hue")');
    assert((await phonePanel()).open.length === 0, 'tapping the open row closes its list');
    // A seed chosen by tap, from the part of the list on screen.
    await tapAt('.garden-context-menu > .garden-menu-item:has-text("Seed")');
    const phoneSeed = await mpage.evaluate(() => {
        const list = document.querySelector('.garden-menu-panel.is-open');
        const box = list.getBoundingClientRect();
        const row = [...list.querySelectorAll('.garden-menu-item')].find((el) => {
            const r = el.getBoundingClientRect();
            return !el.classList.contains('is-active') && r.top >= box.top && r.bottom <= box.bottom;
        });
        const r = row.getBoundingClientRect();
        return { path: row.dataset.seed, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await touch('touchStart', phoneSeed.x, phoneSeed.y);
    await touch('touchEnd', phoneSeed.x, phoneSeed.y);
    await mpage.waitForFunction((path) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects[0].seedImagePath === path, phoneSeed.path);
    assert(await mpage.$('.garden-context-menu') === null, 'choosing a seed by tap should close the menu');

    // Drag the divider with a finger.
    const before = await mpage.$eval('.garden-canvas-area', (el) => el.getBoundingClientRect().height);
    const [rx, ry] = await center('.garden-resizer');
    await touch('touchStart', rx, ry);
    for (let i = 1; i <= 6; i++) await touch('touchMove', rx, ry + i * 20);
    await touch('touchEnd', rx, ry + 120);
    await mpage.waitForTimeout(150);
    const after = await mpage.$eval('.garden-canvas-area', (el) => el.getBoundingClientRect().height);
    console.log('divider drag:', Math.round(before), '->', Math.round(after));
    assert(after > before + 60, `dragging the divider did not resize the canvas: ${before} -> ${after}`);

    // Pan view: the garden alone on the whole screen, where a finger pans it
    // and no touch reaches the page, so Obsidian or the browser never swipe.
    const camera = () => mpage.evaluate(() => {
        const viewport = document.querySelector('.garden-canvas-viewport');
        const m = new DOMMatrix(getComputedStyle(document.querySelector('.garden-world')).transform);
        const vr = viewport.getBoundingClientRect();
        const plant = document.querySelector('.garden-plant-wrapper').getBoundingClientRect();
        return {
            x: m.m41,
            zoom: m.a,
            // The world x in the middle of the pane: what a sideways pan moves.
            centre: (vr.width / 2 - m.m41) / m.a,
            ground: (plant.top - vr.top) / vr.height,
            height: vr.height,
        };
    });
    assert(await mpage.isVisible('.garden-pan-toggle'), 'the pan view button should show on a phone');
    const panButton = await mpage.$eval('.garden-pan-toggle', (el) => el.getBoundingClientRect().toJSON());
    assert(panButton.right <= 390 && panButton.top >= 0, `the pan view button is off screen: ${JSON.stringify(panButton)}`);
    const beforePan = await camera();
    await tapAt('.garden-pan-toggle');
    await mpage.waitForSelector('.garden-pan-layer .garden-canvas-viewport');
    const panOpen = await mpage.evaluate(() => {
        const viewport = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const world = document.querySelector('.garden-world').getBoundingClientRect();
        const exit = document.querySelector('.garden-pan-exit').getBoundingClientRect();
        return {
            viewport: [viewport.left, viewport.top, viewport.width, viewport.height],
            world: [world.top, world.bottom],
            exit: exit.toJSON(),
            inHost: !!document.querySelector('#app .garden-canvas-viewport'),
            boardShown: document.querySelector('.kanban-scroll-container').getClientRects().length > 0,
            // Whatever was there before, the garden is what a finger meets now.
            onTop: [[20, 20], [innerWidth - 20, innerHeight - 20]]
                .every(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.garden-pan-layer')),
        };
    });
    console.log('pan view:', panOpen);
    assert.deepEqual(panOpen.viewport, [0, 0, 390, 844], `pan view should fill the screen: ${JSON.stringify(panOpen)}`);
    assert(panOpen.world[0] <= 1 && panOpen.world[1] >= 843, `the garden should fill pan view from top to bottom: ${JSON.stringify(panOpen)}`);
    assert(!panOpen.inHost && !panOpen.boardShown && panOpen.onTop, `pan view should lie over the app and hide the board: ${JSON.stringify(panOpen)}`);
    assert(Math.abs(panOpen.exit.left - panButton.left) <= 1 && Math.abs(panOpen.exit.top - panButton.top) <= 1,
        `the X should sit where the pan button was: ${JSON.stringify({ button: panButton, exit: panOpen.exit })}`);

    const openPan = await camera();
    await mpage.evaluate(() => {
        window.__panLeaks = 0;
        window.__panWatch = new AbortController();
        for (const type of ['touchstart', 'touchmove', 'touchend', 'pointermove']) {
            document.addEventListener(type, () => { window.__panLeaks++; }, { signal: window.__panWatch.signal });
        }
    });
    await touch('touchStart', 300, 420);
    for (let i = 1; i <= 8; i++) await touch('touchMove', 300 - i * 20, 420);
    const draggedPan = await camera();
    await touch('touchEnd', 140, 420);
    await mpage.waitForTimeout(400);
    const panPage = await mpage.evaluate(() => {
        window.__panWatch.abort();
        const root = document.scrollingElement;
        return { leaks: window.__panLeaks, scroll: [scrollX, scrollY, root.scrollLeft, root.scrollTop] };
    });
    console.log('pan view drag:', Math.round(openPan.x), '->', Math.round(draggedPan.x), panPage);
    assert(draggedPan.x < openPan.x - 100, `a one-finger drag should pan the garden: ${openPan.x} -> ${draggedPan.x}`);
    assert.deepEqual(panPage.scroll, [0, 0, 0, 0], `the page scrolled under pan view: ${JSON.stringify(panPage)}`);
    assert(panPage.leaks === 0, `touches in pan view reached the page: ${JSON.stringify(panPage)}`);

    const pannedCentre = (await camera()).centre;
    await tapAt('.garden-pan-exit');
    await mpage.waitForFunction(() => !document.querySelector('.garden-pan-layer'));
    const afterPan = await camera();
    const backHome = await mpage.evaluate(() => ({
        inHost: !!document.querySelector('#app > .view-content .garden-canvas-viewport'),
        board: document.querySelector('.kanban-scroll-container').getBoundingClientRect().height,
    }));
    console.log('after pan view:', afterPan, backHome);
    assert(backHome.inHost && backHome.board > 100, `the X should bring back the board and the garden's place: ${JSON.stringify(backHome)}`);
    assert(Math.abs(afterPan.height - beforePan.height) <= 1, `the garden pane changed size: ${beforePan.height} -> ${afterPan.height}`);
    assert(Math.abs(afterPan.zoom - beforePan.zoom) < 0.001, `pan view should give the zoom back: ${beforePan.zoom} -> ${afterPan.zoom}`);
    assert(Math.abs(afterPan.ground - beforePan.ground) < 0.02, `the horizon jumped: ${beforePan.ground} -> ${afterPan.ground}`);
    assert(Math.abs(afterPan.centre - pannedCentre) < 1 && afterPan.centre > beforePan.centre + 100,
        `the pan should stay after pan view: ${JSON.stringify({ before: beforePan.centre, panned: pannedCentre, after: afterPan.centre })}`);
    await mpage.waitForTimeout(1300); // the debounced view-state save
    const panSaved = await mpage.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/view/web')));
    assert(Math.abs(panSaved.translateX - afterPan.x) < 1 && Math.abs(panSaved.zoom - afterPan.zoom) < 0.001,
        `the camera after pan view was not saved: ${JSON.stringify({ saved: panSaved, shown: afterPan })}`);

    // Escape leaves pan view too.
    await tapAt('.garden-pan-toggle');
    await mpage.waitForSelector('.garden-pan-layer');
    await mpage.keyboard.press('Escape');
    await mpage.waitForFunction(() => !document.querySelector('.garden-pan-layer') && !!document.querySelector('#app .garden-canvas-viewport'));

    // Everything was saved.
    await mpage.waitForTimeout(300);
    const phoneSaved = await mpage.evaluate(() => JSON.parse(localStorage.getItem('cells.garden/v1')));
    const stems = phoneSaved.projects[0].stem.map((s) => s.content);
    console.log('phone stems:', stems);
    assert(stems.length === 2 && stems.some((s) => s.endsWith(' edited')), `phone edits were not saved: ${JSON.stringify(stems)}`);
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
