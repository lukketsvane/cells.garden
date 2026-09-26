#!/usr/bin/env node
// Browser smoke test for the web build plus the PWA. Run with "npm run test:web".
//
// Starts "vite preview" on port 4173 (TEST_WEB_PORT overrides it, so two
// checkouts can test at once) against dist/ (building first when dist/
// is missing) and drives the garden with Playwright: plants seeds, adds cells
// to every zone, context menus, pan/zoom, reload persistence, the part a hover
// or a click means, one part's chip with the board hidden (hover, click, tap
// and hold, through a sync and a zoom), a mobile viewport with pan view and the
// calm click flash. Then the PWA: the manifest and sw.js are served, the service
// worker takes control of the page, and the garden still renders offline.
//
// Console errors that are exactly network failures to Supabase/Google are
// tolerated (a sandbox may block those hosts; the app copes). Any other
// console error or page error fails the run. Set SCREENSHOTS=<dir> to save
// screenshots along the way.

import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { checkAndRecycleTutorial } from './test-tutorial.mjs';

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

/** A cell's menu: another of its kind first; in a build with accounts, Assign follows the highlight. */
async function cellMenu(page, highlight, kind) {
    const accounts = (await page.$('.auth-pill')) !== null;
    return [`New ${kind}`, 'Delete', highlight, ...(accounts ? ['Assign'] : []), 'Move to', 'Convert to stem'];
}

// The zone icons are the pixel art in src/assets/pack/kanban_icons, masked in
// the text colour: each zone its own drawing, never smoothed, and a whole
// number of CSS pixels to each of the 9 art pixels a side, so no pixel is
// smeared across two.
async function checkZoneIcons(page, label) {
    const icons = await page.$$eval('.garden-zone .zone-icon', (els) => els.map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
            zone: el.closest('.garden-zone')?.classList[1],
            mask: style.maskImage || style.webkitMaskImage,
            rendering: style.imageRendering,
            scaleX: rect.width / 9,
            scaleY: rect.height / 9,
        };
    }));
    const zones = new Set(icons.map((icon) => icon.zone));
    assert(['flowers-zone', 'stem-zone', 'roots-zone', 'minerals-zone'].every((z) => zones.has(z)), `${label}: a zone lost its icon: ${JSON.stringify(icons)}`);
    const drawings = new Map();
    for (const icon of icons) {
        assert(/^url\(/.test(icon.mask), `${label}: a zone icon has no drawing: ${JSON.stringify(icon)}`);
        assert.equal(drawings.get(icon.zone) ?? icon.mask, icon.mask, `${label}: one zone shows two drawings`);
        drawings.set(icon.zone, icon.mask);
        assert.equal(icon.rendering, 'pixelated', `${label}: a zone icon is smoothed: ${JSON.stringify(icon)}`);
        assert(Number.isInteger(icon.scaleX) && icon.scaleX >= 1 && icon.scaleX === icon.scaleY,
            `${label}: a zone icon is not a whole number of CSS pixels per art pixel: ${JSON.stringify(icon)}`);
    }
    assert.equal(new Set(drawings.values()).size, drawings.size, `${label}: two zones share a drawing`);
    console.log(`${label} zone icons:`, [...new Set(icons.map((icon) => `9x9 at ${icon.scaleX}x`))].join(', '));
}

// The garden on screen is the stored one, drawn whole: no redraw under way,
// every plant drawn part by part (renderPlantSprite leaves data-width when it
// is done), then a moment for the horizon, which settles two frames after a
// swap. A save writes the store before it draws, so counting the parts against
// the store waits out the redraw an edit starts, too. A plant on standby draws
// no minerals while the garden hides them (standbyHidesMinerals, on unless off).
async function gardenSettled(page) {
    await page.waitForFunction(() => {
        const garden = JSON.parse(localStorage.getItem('cells.garden/v1') || 'null');
        if (!garden || document.querySelector('.garden-render-stage')) return false;
        const wrappers = [...document.querySelectorAll('.garden-plant-wrapper')];
        const parts = document.querySelectorAll('.garden-plant-wrapper .garden-part[data-item-id]').length;
        const hidesMinerals = garden.settings?.standbyHidesMinerals !== false;
        const cells = garden.projects.reduce((n, p) => n + 1 + p.flowers.length + p.stem.length + p.roots.length
            + (p.standby && hidesMinerals ? 0 : p.minerals.length), 0);
        return wrappers.length === garden.projects.length && wrappers.every((w) => w.dataset.width) && parts === cells;
    });
    await page.waitForTimeout(200);
}

// In the page: a part's sprite read the way the garden reads it, to tell its
// own pixels from the see-through rest of its box (drawnAt) and to find where
// they are on screen (drawnRect). Installed once per page load.
function spriteReader() {
    if (window.__parts) return;
    const sprites = new Map();
    const spriteOf = async (part) => {
        const url = /url\("?(.*?)"?\)/.exec(part.style.backgroundImage || part.style.getPropertyValue('mask-image'))?.[1];
        if (!url) return null;
        if (!sprites.has(url)) {
            const img = new Image();
            img.src = url;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            sprites.set(url, { w: canvas.width, h: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data });
        }
        return sprites.get(url);
    };
    // Firmly drawn at a point: a spot to point at, not an edge.
    const drawnAt = async (part, x, y) => {
        const sprite = await spriteOf(part);
        if (!sprite) return true;
        const r = part.getBoundingClientRect();
        const col = Math.floor(((x - r.left) / r.width) * sprite.w);
        const row = Math.floor(((y - r.top) / r.height) * sprite.h);
        const ax = part.dataset.flipped ? sprite.w - 1 - col : col;
        return ax >= 0 && row >= 0 && ax < sprite.w && row < sprite.h && sprite.data[(row * sprite.w + ax) * 4 + 3] > 128;
    };
    const drawnRect = async (part) => {
        const sprite = await spriteOf(part);
        const r = part.getBoundingClientRect();
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let y = 0; sprite && y < sprite.h; y++) {
            for (let x = 0; x < sprite.w; x++) {
                if (sprite.data[(y * sprite.w + x) * 4 + 3] <= 32) continue;
                x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            }
        }
        if (x1 < 0) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        const sx = r.width / sprite.w, sy = r.height / sprite.h;
        const [from, to] = part.dataset.flipped ? [sprite.w - 1 - x1, sprite.w - x0] : [x0, x1 + 1];
        return { left: r.left + from * sx, top: r.top + y0 * sy, right: r.left + to * sx, bottom: r.top + (y1 + 1) * sy };
    };
    window.__parts = { spriteOf, drawnAt, drawnRect };
}

// A point on a plant part's own pixels with no part drawn over it there: the
// part a tap or a hover at that point means. A sprite's box is mostly
// see-through; `covered` asks for a point under another part's box, where only
// a pixel-true hit test finds the part underneath. Whole pixels, as a mouse
// event reports them.
async function partSpot(page, selector, { covered = false } = {}) {
    await page.evaluate(spriteReader);
    return page.evaluate(async ({ selector, covered }) => {
        const { spriteOf, drawnAt } = window.__parts;
        for (const part of document.querySelectorAll(selector)) {
            const sprite = await spriteOf(part);
            if (!sprite) continue;
            const r = part.getBoundingClientRect();
            const cells = [];
            for (let row = 0; row < sprite.h; row++) for (let col = 0; col < sprite.w; col++) cells.push([col, row]);
            cells.sort((a, b) => Math.hypot(a[0] - sprite.w / 2, a[1] - sprite.h / 2) - Math.hypot(b[0] - sprite.w / 2, b[1] - sprite.h / 2));
            for (const [col, row] of cells) {
                const x = Math.floor(r.left + ((col + 0.5) * r.width) / sprite.w);
                const y = Math.floor(r.top + ((row + 0.5) * r.height) / sprite.h);
                if (!(await drawnAt(part, x, y))) continue;
                const stack = document.elementsFromPoint(x, y);
                const at = stack.indexOf(part);
                // On screen, and under nothing but other parts' boxes (not the board, a button, a chip).
                if (at === -1 || stack.slice(0, at).some((el) => !el.matches('.garden-part'))) continue;
                if (covered !== (at > 0)) continue;
                let over = false;
                for (const el of stack.slice(0, at)) over ||= await drawnAt(el, x, y);
                if (!over) return { x, y, itemId: part.dataset.itemId, covered: at > 0 };
            }
        }
        return null;
    }, { selector, covered });
}

// A point on the garden with nothing on it: no part, no chip, no worm (which
// starts drawing), no menu, no button.
async function emptySpot(page) {
    return page.evaluate(() => {
        const frame = document.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        for (let fy = 0.92; fy > 0.08; fy -= 0.04) {
            for (let fx = 0.1; fx < 0.95; fx += 0.08) {
                const x = Math.floor(frame.left + frame.width * fx);
                const y = Math.floor(frame.top + frame.height * fy);
                const el = document.elementFromPoint(x, y);
                if (el?.closest('.garden-canvas-viewport') && !el.closest('.garden-part, .garden-peek-chip, .garden-worm-hitbox, .garden-context-menu, button')) return { x, y };
            }
        }
        return null;
    });
}

// The chip over the garden and the part it speaks for, as a reader sees them:
// the part is its own pixels, not its mostly see-through box.
async function chipState(page) {
    await page.evaluate(spriteReader);
    return page.evaluate(async () => {
        const chips = [...document.querySelectorAll('.garden-peek-chip.is-visible')];
        const parts = [...document.querySelectorAll('.garden-part-peeked')];
        const chip = chips[0];
        if (!chip) return { count: 0, marked: parts.length, rings: document.querySelectorAll('.garden-peek-ring').length };
        const c = chip.getBoundingClientRect();
        const p = parts[0] ? await window.__parts.drawnRect(parts[0]) : null;
        const frame = chip.closest('.garden-canvas-viewport').getBoundingClientRect();
        return {
            count: chips.length,
            id: chip.dataset.id,
            text: chip.textContent.trim(),
            column: !!chip.querySelector('.project-column, .column-card, .garden-zone, .zone-add-btn'),
            pinned: chip.classList.contains('is-selected'),
            editing: chip.classList.contains('is-editing'),
            pointer: getComputedStyle(chip).pointerEvents,
            inPanLayer: !!chip.closest('.garden-pan-layer'),
            marked: parts.length,
            markedId: parts[0]?.dataset.itemId,
            markedPlant: parts[0]?.closest('.garden-plant-wrapper')?.dataset.projectId,
            // One ring, on the marked part's plant.
            rings: document.querySelectorAll('.garden-peek-ring').length,
            ringOnPlant: !!parts[0] && document.querySelector('.garden-peek-ring')?.parentElement === parts[0].closest('.garden-plant-wrapper'),
            inView: c.left >= Math.max(0, frame.left) && c.top >= Math.max(0, frame.top)
                && c.right <= Math.min(innerWidth, frame.right) && c.bottom <= Math.min(innerHeight, frame.bottom),
            overlapsPart: !!p && c.left < p.right && c.right > p.left && c.top < p.bottom && c.bottom > p.top,
            rect: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)],
            part: p && [p.left, p.top, p.right, p.bottom].map(Math.round),
        };
    });
}

// Wait for the chip, its ring and any menu to be gone; say what stayed if they do not go.
async function peekGone(page, label) {
    try {
        await page.waitForFunction(() => !document.querySelector('.garden-context-menu, .garden-peek-chip.is-visible, .garden-part-peeked, .garden-peek-ring'), null, { timeout: 5000 });
    } catch {
        const left = await page.evaluate(() => ({
            menu: !!document.querySelector('.garden-context-menu'),
            chips: [...document.querySelectorAll('.garden-peek-chip')].map((c) => `${c.className} ${c.dataset.id} ${c.isConnected}`),
            peeked: [...document.querySelectorAll('.garden-part-peeked')].map((p) => p.dataset.itemId),
            rings: document.querySelectorAll('.garden-peek-ring').length,
            active: document.activeElement?.className ?? document.activeElement?.tagName,
        }));
        throw new Error(`${label}: the chip should be gone: ${JSON.stringify(left)}`);
    }
}

// Watch a board cell through its click flash, frame by frame: it must never
// grow past its own box (a scaled cell was clipped by its card).
function watchFlash(page, itemId) {
    return page.evaluate((id) => {
        window.__flash = [];
        const start = performance.now();
        const tick = () => {
            const cell = [...document.querySelectorAll('.kanban-scroll-container .garden-item, .kanban-scroll-container .seed-content')]
                .find((el) => el.dataset.id === id);
            if (cell?.classList.contains('is-click-flash')) {
                const r = cell.getBoundingClientRect();
                const card = cell.closest('.column-card').getBoundingClientRect();
                const style = getComputedStyle(cell);
                window.__flash.push({
                    transform: style.transform,
                    background: style.backgroundColor,
                    animation: style.animationName,
                    inside: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top >= card.top - 0.5 && r.bottom <= card.bottom + 0.5,
                });
            }
            if (performance.now() - start < 1100) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, itemId);
}

async function checkFlash(page, label) {
    await page.waitForTimeout(1200);
    const samples = await page.evaluate(() => window.__flash);
    const colours = new Set(samples.map((s) => s.background));
    console.log(`${label} click flash:`, samples.length, 'frames,', colours.size, 'colours, transforms', [...new Set(samples.map((s) => s.transform))]);
    assert(samples.length > 0, `${label}: the cell never flashed`);
    assert(samples.every((s) => s.transform === 'none'), `${label}: the flash transformed the cell: ${JSON.stringify(samples)}`);
    assert(samples.every((s) => s.inside), `${label}: the flash reached past the cell's card: ${JSON.stringify(samples)}`);
    assert(samples.some((s) => s.animation === 'garden-cell-click-flash') && colours.size > 1, `${label}: the flash should tint the cell: ${JSON.stringify(samples)}`);
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
    await checkAndRecycleTutorial(page);
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
    await gardenSettled(page);
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
    assert.deepEqual(plantMenu, ['Add', 'Standby', 'Plant type', 'Seed', 'Tags', 'Plant hue', 'Recycle plant']);

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

    // Tags: a plant's menu puts them on it; hiding one takes every plant with
    // it out of the garden and off the board, on this device only, and the
    // board says so and brings them back. The pill menu hides and shows too.
    const plantsShown = () => page.evaluate(() => ({
        garden: [...document.querySelectorAll('.garden-plant-wrapper')].map((w) => w.dataset.projectId),
        board: [...document.querySelectorAll('.kanban-scroll-container > .project-column')].map((c) => c.dataset.projectId),
        note: document.querySelector('.kanban-hidden-note')?.textContent ?? null,
    }));
    const allShown = await plantsShown();
    await openPlantMenu();
    await page.click(menuRow('Tags'));
    await page.fill('.garden-menu-tag-field', '  Side   project ');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => JSON.stringify(JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === id).tags) === '["Side project"]', plantId);
    const tagRows = await page.$$eval('.garden-menu-panel.is-open [data-tag]', (els) => els.map((e) => [e.dataset.tag, e.classList.contains('is-active')]));
    assert.deepEqual(tagRows, [['Side project', true]], 'a new tag should be on the plant, ticked in its panel');
    assert.equal(await page.$eval(`${menuRow('Tags')} .garden-menu-sub`, (el) => el.textContent), 'Side project', 'the Tags row names the plant\'s tags');
    await page.click('.garden-menu-panel.is-open [data-hide-tag="Side project"]');
    const hiddenPlant = (hidden) => page.waitForFunction(({ id, hidden }) => {
        const drawn = !!document.querySelector(`.garden-plant-wrapper[data-project-id="${id}"]`);
        return drawn !== hidden && !document.querySelector('.garden-render-stage') && !!document.querySelector('.kanban-hidden-note') === hidden;
    }, { id: plantId, hidden }, { timeout: 5000 });
    await hiddenPlant(true);
    const whileHidden = await plantsShown();
    assert(!whileHidden.garden.includes(plantId) && !whileHidden.board.includes(plantId) && whileHidden.garden.length === allShown.garden.length - 1 && whileHidden.note === '1 plant hidden',
        `hiding a tag should take its plant out of the garden and off the board: ${JSON.stringify({ allShown, whileHidden })}`);
    assert.deepEqual((await stored(plantId)).tags, ['Side project'], 'hiding a tag must leave the plant as it is');
    await page.click('.kanban-hidden-note');
    await page.click('.garden-context-menu .garden-menu-item:has(.garden-menu-label:text-is("Side project"))');
    await hiddenPlant(false);
    if (await page.$('.auth-pill')) {
        await page.click('.auth-pill');
        await page.click('.garden-context-menu > .garden-menu-item:has(.garden-menu-label:text-is("Tags"))');
        await page.click('.garden-menu-panel.is-open [data-tag="Side project"]');
        await hiddenPlant(true);
        assert.equal(await page.$eval('.garden-context-menu > .garden-menu-item:has(.garden-menu-label:text-is("Tags")) .garden-menu-sub', (el) => el.textContent), '1 hidden');
        await page.click('.garden-menu-panel.is-open [data-tag="Side project"]');
        await hiddenPlant(false);
        await page.keyboard.press('Escape');
    }
    await settled();
    assert.deepEqual(await plantsShown(), allShown, 'showing the tag again should put the garden back as it was');

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

    // With the board shown, the part lit under the mouse is the part a click
    // there means: one drawn under another part's see-through box is found by
    // its own pixels, for the hover and the click alike. Its cell flashes, a
    // tint inside its own box.
    await gardenSettled(page);
    const deskCovered = await partSpot(page, '.garden-part[data-item-id]', { covered: true });
    const deskFocus = deskCovered ?? await partSpot(page, '.garden-stem-part');
    assert(deskFocus, 'no plant part to point at on the desktop');
    await page.mouse.move(deskFocus.x, deskFocus.y);
    await page.waitForTimeout(100);
    const lit = await page.evaluate(() => ({
        parts: [...document.querySelectorAll('.garden-part.is-hovered')].map((p) => p.dataset.itemId),
        cells: [...document.querySelectorAll('.kanban-scroll-container .is-hover-highlighted')].map((c) => c.dataset.id),
    }));
    console.log('desktop hover:', deskFocus, lit);
    assert.deepEqual(lit, { parts: [deskFocus.itemId], cells: [deskFocus.itemId] }, `the mouse should light the part drawn under it, and its cell: ${JSON.stringify({ deskFocus, lit })}`);
    await watchFlash(page, deskFocus.itemId);
    await page.mouse.click(deskFocus.x, deskFocus.y);
    await page.waitForTimeout(100);
    const deskFocused = await page.evaluate(() => [...document.querySelectorAll('.is-focus-highlighted')].map((c) => c.dataset.id));
    assert.deepEqual(deskFocused, [deskFocus.itemId], `a click should focus the cell of the part lit under the mouse: ${JSON.stringify({ deskFocus, deskFocused })}`);
    await checkFlash(page, 'desktop');

    // With the board hidden the garden speaks for itself one part at a time:
    // hovering a flower rings that flower and shows its one cell beside it.
    await page.click('.garden-board-toggle');
    await page.waitForFunction(() => document.documentElement.dataset.board === 'hidden');
    await gardenSettled(page);
    await page.waitForTimeout(300); // the camera follows the pane growing
    const deskFlower = await partSpot(page, '.garden-flower-part');
    assert(deskFlower, 'no flower to hover with the board hidden');
    const deskEmpty = await emptySpot(page);
    assert(deskEmpty, 'no empty garden to point at');
    await page.mouse.move(deskEmpty.x, deskEmpty.y);
    await page.mouse.move(deskFlower.x, deskFlower.y);
    await page.waitForTimeout(100);
    assert((await chipState(page)).count === 0, 'the chip should wait a beat before it appears (hover intent)');
    await page.waitForSelector('.garden-peek-chip.is-visible');
    const hoverChip = await chipState(page);
    console.log('hover chip:', hoverChip);
    assert(hoverChip.count === 1 && hoverChip.text === 'Runs in browser' && hoverChip.id === deskFlower.itemId, `hovering a flower should show that flower's cell alone: ${JSON.stringify(hoverChip)}`);
    assert(!hoverChip.column && !hoverChip.pinned, `the chip should be one cell, not a card: ${JSON.stringify(hoverChip)}`);
    assert(hoverChip.marked === 1 && hoverChip.markedId === deskFlower.itemId && hoverChip.rings === 1 && hoverChip.ringOnPlant, `the flower should be ringed: ${JSON.stringify(hoverChip)}`);
    assert(hoverChip.inView && !hoverChip.overlapsPart, `the chip should sit beside the flower's own pixels, on screen: ${JSON.stringify(hoverChip)}`);
    await shot(page, '03b-peek-hover.png');

    // Already showing, the chip follows the mouse to the next part at once.
    const deskStem = await partSpot(page, '.garden-stem-part');
    assert(deskStem, 'no stem to move to');
    await page.mouse.move(deskStem.x, deskStem.y);
    await page.waitForTimeout(60);
    const movedChip = await chipState(page);
    assert(movedChip.count === 1 && movedChip.id === deskStem.itemId && movedChip.markedId === deskStem.itemId && movedChip.text === 'Scaffold + shim'
        && movedChip.rings === 1 && !movedChip.overlapsPart, `the chip should move with the mouse to the stem: ${JSON.stringify(movedChip)}`);
    await page.mouse.move(deskEmpty.x, deskEmpty.y);
    await peekGone(page, 'pointer off the plant');

    // A click pins it: it stays when the pointer leaves, and through a redraw.
    await page.mouse.click(deskFlower.x, deskFlower.y);
    await page.mouse.move(deskEmpty.x, deskEmpty.y);
    await page.waitForTimeout(400);
    assert((await chipState(page)).pinned, 'a click on a part should pin its chip');
    await page.evaluate(() => window.garden.view.onOpen());
    await page.waitForFunction((id) => document.querySelector('.garden-peek-chip.is-visible')?.dataset.id === id
        && document.querySelector('.garden-part-peeked')?.dataset.itemId === id
        && document.querySelectorAll('.garden-peek-ring').length === 1, deskFlower.itemId);

    // Pinned, a double-click writes in it through the board's own path.
    await page.dblclick('.garden-peek-chip.is-visible');
    await page.waitForSelector('.garden-peek-chip.is-editing');
    await page.keyboard.press('End');
    await page.keyboard.type(' fast');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects
        .flatMap((p) => p.flowers).find((f) => f.id === id)?.content === 'Runs in browser fast', deskFlower.itemId);
    const written = await page.evaluate((id) => ({
        chip: document.querySelector('.garden-peek-chip.is-visible')?.textContent,
        board: [...document.querySelectorAll('.kanban-scroll-container .garden-item')].find((el) => el.dataset.id === id)?.textContent,
    }), deskFlower.itemId);
    assert(written.chip === 'Runs in browser fast' && written.board === 'Runs in browser fast', `the chip's edit should show in the chip and on the board: ${JSON.stringify(written)}`);

    // A right-click opens the cell's own menu. Escape closes the menu alone;
    // a second Escape lets the chip go.
    await page.click('.garden-peek-chip.is-visible', { button: 'right' });
    await page.waitForSelector('.garden-context-menu');
    const chipMenu = await page.$$eval('.garden-context-menu > .garden-menu-item > .garden-menu-label', (els) => els.map((e) => e.textContent));
    // The flower was highlighted from its menu on the board, earlier.
    assert.deepEqual(chipMenu, await cellMenu(page, 'Remove highlight', 'flower'), 'the chip should open its cell\'s menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.garden-context-menu'));
    const afterMenu = await chipState(page);
    assert(afterMenu.count === 1 && afterMenu.pinned && afterMenu.id === deskFlower.itemId, `Escape should close the menu and keep the chip: ${JSON.stringify(afterMenu)}`);
    await page.keyboard.press('Escape');
    await peekGone(page, 'a second Escape');

    // A click on the empty garden lets it go, and so does a drag of the garden.
    await page.mouse.click(deskFlower.x, deskFlower.y);
    await page.waitForSelector('.garden-peek-chip.is-visible.is-selected');
    await page.mouse.click(deskEmpty.x, deskEmpty.y);
    await peekGone(page, 'click on the empty garden');
    await page.mouse.click(deskFlower.x, deskFlower.y);
    await page.waitForSelector('.garden-peek-chip.is-visible.is-selected');
    await page.mouse.move(deskEmpty.x, deskEmpty.y);
    await page.mouse.down();
    await page.mouse.move(deskEmpty.x + 60, deskEmpty.y - 20, { steps: 4 });
    await page.mouse.up();
    await peekGone(page, 'a drag of the garden');
    await page.waitForTimeout(500); // the camera settles

    // The seed's chip is its plant's name.
    const deskSeed = await partSpot(page, '.garden-seed-part');
    assert(deskSeed, 'no seed to click');
    await page.mouse.click(deskSeed.x, deskSeed.y);
    await page.waitForSelector('.garden-peek-chip.is-visible.is-selected');
    const seedChip = await chipState(page);
    const seedName = await page.evaluate((id) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === id)?.seed, deskSeed.itemId);
    assert(seedChip.id === deskSeed.itemId && seedChip.text === seedName && seedChip.markedId === deskSeed.itemId && !seedChip.overlapsPart,
        `the seed's chip should show its plant's name: ${JSON.stringify({ seedChip, seedName })}`);

    // A sync from another tab or device draws the garden again: the pinned
    // chip comes back on its part, on whichever plant the cell is on now, and
    // goes once the cell is gone.
    const syncFlower = (how, id) => page.evaluate(({ how, id }) => {
        const garden = JSON.parse(localStorage.getItem('cells.garden/v1'));
        const from = garden.projects.find((p) => p.flowers.some((f) => f.id === id));
        const flower = from.flowers.find((f) => f.id === id);
        if (how === 'edit') flower.content = 'Runs everywhere';
        if (how !== 'edit') from.flowers = from.flowers.filter((f) => f !== flower);
        if (how === 'move') garden.projects.find((p) => p !== from).flowers.push(flower);
        garden.updatedAt = new Date(Date.now() + 1000).toISOString();
        const value = JSON.stringify(garden);
        // What another tab's save looks like here.
        localStorage.setItem('cells.garden/v1', value);
        window.dispatchEvent(new StorageEvent('storage', { key: 'cells.garden/v1', newValue: value }));
        return garden.projects.find((p) => p.flowers.some((f) => f.id === id))?.id ?? null;
    }, { how, id });
    const syncedFlower = await partSpot(page, '.garden-flower-part');
    assert(syncedFlower, 'no flower to pin before a sync');
    await page.mouse.click(syncedFlower.x, syncedFlower.y);
    await page.waitForSelector('.garden-peek-chip.is-visible.is-selected');
    const syncWait = (id, text, plant) => page.waitForFunction(({ id, text, plant }) => {
        const chip = document.querySelector('.garden-peek-chip.is-visible.is-selected');
        const part = document.querySelector('.garden-part-peeked');
        return chip?.dataset.id === id && chip.textContent.trim() === text && part?.dataset.itemId === id
            && part.closest('.garden-plant-wrapper')?.dataset.projectId === plant && document.querySelectorAll('.garden-peek-ring').length === 1;
    }, { id, text, plant }, { timeout: 5000 });
    let plantOfFlower = await syncFlower('edit', syncedFlower.itemId);
    await syncWait(syncedFlower.itemId, 'Runs everywhere', plantOfFlower);
    plantOfFlower = await syncFlower('move', syncedFlower.itemId);
    await syncWait(syncedFlower.itemId, 'Runs everywhere', plantOfFlower);
    console.log('pinned chip after a sync moved its cell:', await chipState(page));
    await syncFlower('delete', syncedFlower.itemId);
    await peekGone(page, 'a sync that deletes the cell');

    // With the board hidden a part's menu grows another of its kind right
    // there: the new part's chip opens, empty, to be written in, and Enter
    // keeps it. Escape takes a new one away again, as an empty draft on the
    // board goes.
    await gardenSettled(page);
    const rootSpot = async () => await partSpot(page, '.garden-root-part') ?? await partSpot(page, '.garden-root-part', { covered: true });
    const growFrom = await rootSpot();
    assert(growFrom, 'no root to grow another from');
    const growPlant = await page.evaluate((id) => document.querySelector(`.garden-plants-layer [data-item-id="${id}"]`).closest('.garden-plant-wrapper').dataset.projectId, growFrom.itemId);
    const rootsOf = () => page.evaluate((pid) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === pid).roots.map((s) => s.content), growPlant);
    const rootsBefore = await rootsOf();
    const newRoot = async (at) => {
        await page.mouse.click(at.x, at.y, { button: 'right' });
        await page.waitForSelector('.garden-context-menu');
        await page.click('.garden-context-menu .garden-menu-item:has(.garden-menu-label:text-is("New root"))');
        await page.waitForSelector('.garden-peek-chip.is-visible.is-editing', { timeout: 5000 });
        return chipState(page);
    };
    const grown = await newRoot(growFrom);
    assert(grown.pinned && grown.editing && grown.text === '' && grown.id !== growFrom.itemId && grown.markedId === grown.id,
        `a new root should open its own chip, empty, on its own part: ${JSON.stringify(grown)}`);
    await page.keyboard.type('Grown in the garden');
    await page.keyboard.press('Enter');
    await page.waitForFunction((pid) => JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === pid).roots[0]?.content === 'Grown in the garden', growPlant);
    assert.deepEqual(await rootsOf(), ['Grown in the garden', ...rootsBefore], 'Enter should keep the new root, on top');
    await page.keyboard.press('Escape');
    await peekGone(page, 'Escape after growing a root');
    await gardenSettled(page);
    const dropped = await newRoot(await rootSpot());
    await page.keyboard.press('Escape');
    await peekGone(page, 'Escape on a new root');
    await page.waitForFunction(({ pid, id }) => !JSON.parse(localStorage.getItem('cells.garden/v1')).projects.find((p) => p.id === pid).roots.some((s) => s.id === id), { pid: growPlant, id: dropped.id });
    assert.deepEqual(await rootsOf(), ['Grown in the garden', ...rootsBefore], 'Escape should take the new root away');

    // Zooming the garden lets a pinned chip go.
    await gardenSettled(page);
    const zoomStem = await partSpot(page, '.garden-stem-part');
    assert(zoomStem, 'no stem to pin before a zoom');
    await page.mouse.click(zoomStem.x, zoomStem.y);
    await page.waitForSelector('.garden-peek-chip.is-visible.is-selected');
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await peekGone(page, 'a zoom of the garden');
    await page.click('.garden-board-toggle');
    await page.waitForFunction(() => document.documentElement.dataset.board === 'shown');

    // The worm's drawing toolbar takes the corner the board toggle sits in: the
    // toggle steps aside while drawing, even when a sync draws the garden again,
    // and comes back with the toolbar's ✕.
    await gardenSettled(page);
    const corner = () => page.evaluate(() => ({
        toggle: !!document.querySelector('.garden-board-toggle')?.getClientRects().length,
        toolbars: document.querySelectorAll('.drawing-toolbar').length,
    }));
    await page.$eval('.garden-worm-hitbox', (el) => el.click());
    await page.waitForSelector('.drawing-toolbar');
    assert.deepEqual(await corner(), { toggle: false, toolbars: 1 }, 'drawing should hide the board toggle under its toolbar');
    await page.evaluate(() => {
        const garden = JSON.parse(localStorage.getItem('cells.garden/v1'));
        garden.projects[0].seed = garden.projects[0].name = 'Drawn over';
        garden.updatedAt = new Date(Date.now() + 1000).toISOString();
        const value = JSON.stringify(garden);
        localStorage.setItem('cells.garden/v1', value);
        window.dispatchEvent(new StorageEvent('storage', { key: 'cells.garden/v1', newValue: value }));
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.seed-content')].some((el) => el.textContent === 'Drawn over'));
    await gardenSettled(page);
    assert.deepEqual(await corner(), { toggle: false, toolbars: 1 }, 'a redraw while drawing should keep the toolbar, and the toggle aside');
    await page.click('.drawing-toolbar-btn:has-text("✕")');
    assert.deepEqual(await corner(), { toggle: true, toolbars: 0 }, 'leaving drawing mode should bring the board toggle back');

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
    await checkAndRecycleTutorial(mpage);
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
    // The last cell's redraw would swap the board out from under the icons being measured.
    await gardenSettled(mpage);
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
    // direct touch-end path rather than a synthetic click. The stem just added is
    // still being drawn: wait for the garden to hold still, then tap one of the
    // part's own pixels, so the part meant is not a guess from its box.
    await gardenSettled(mpage);
    const plantPartTap = await partSpot(mpage, '.garden-stem-part');
    assert(plantPartTap, 'no tappable plant part was found on mobile');
    await watchFlash(mpage, plantPartTap.itemId);
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
    // The flash stays in the cell: a tint, no growing past the card.
    await checkFlash(mpage, 'mobile');

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
    await mpage.evaluate(() => window.garden.view.scheduleRender());
    await mpage.waitForTimeout(120);
    assert(await mpage.locator('.garden-resizer.is-dragging').count(), 'a queued redraw must not replace the held divider');
    for (let i = 1; i <= 6; i++) await touch('touchMove', rx, ry + i * 20);
    await touch('touchEnd', rx, ry + 120);
    await mpage.waitForTimeout(150);
    const after = await mpage.$eval('.garden-canvas-area', (el) => el.getBoundingClientRect().height);
    console.log('divider drag:', Math.round(before), '->', Math.round(after));
    assert(after > before + 60, `dragging the divider did not resize the canvas: ${before} -> ${after}`);

    await gardenSettled(mpage);
    const [cx, cy] = await center('.garden-resizer');
    await touch('touchStart', cx, cy);
    await touch('touchMove', cx, cy - 20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await mpage.locator('.garden-resizer.is-dragging').count(), 0, 'touch cancellation releases the divider');
    assert.notEqual(await mpage.evaluate(() => document.body.style.cursor), 'row-resize');

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

    // The board hidden on a phone: a tap on a flower shows that flower's one
    // cell beside it, a second tap writes in it, a hold opens its menu, and a
    // tap on the empty garden lets it go.
    await tapAt('.flowers-zone .zone-add-btn');
    await mpage.waitForSelector('.garden-item.is-draft');
    await mpage.fill('.garden-item.is-draft', 'Phone flower');
    await mpage.keyboard.press('Enter');
    await gardenSettled(mpage);
    await tapAt('.garden-board-toggle');
    await mpage.waitForFunction(() => document.documentElement.dataset.board === 'hidden');
    await gardenSettled(mpage);
    await mpage.waitForTimeout(300); // the camera follows the pane growing
    const phoneFlower = await partSpot(mpage, '.garden-flower-part');
    assert(phoneFlower, 'no flower to tap with the board hidden');
    await touch('touchStart', phoneFlower.x, phoneFlower.y);
    await touch('touchEnd', phoneFlower.x, phoneFlower.y);
    await mpage.waitForTimeout(200);
    const phoneChip = await chipState(mpage);
    console.log('phone chip:', phoneChip);
    assert(phoneChip.count === 1 && phoneChip.text === 'Phone flower' && phoneChip.id === phoneFlower.itemId && phoneChip.pinned,
        `tapping a flower should pin that flower's cell alone: ${JSON.stringify(phoneChip)}`);
    assert(!phoneChip.column && phoneChip.marked === 1 && phoneChip.markedId === phoneFlower.itemId && phoneChip.rings === 1 && phoneChip.ringOnPlant,
        `one cell, its flower ringed: ${JSON.stringify(phoneChip)}`);
    assert(phoneChip.inView && !phoneChip.overlapsPart, `the chip should sit beside the flower's own pixels, on screen: ${JSON.stringify(phoneChip)}`);
    await shot(mpage, '04b-mobile-peek.png');

    await tapAt('.garden-peek-chip.is-visible');
    await mpage.waitForSelector('.garden-peek-chip.is-editing');
    const chipFont = await mpage.$eval('.garden-peek-chip.is-editing', (el) => parseFloat(getComputedStyle(el).fontSize));
    assert(chipFont >= 16, `the chip being written in is ${chipFont}px; iOS would zoom`);
    await mpage.keyboard.press('End');
    await mpage.keyboard.type(' grown');
    await mpage.keyboard.press('Enter');
    await mpage.waitForFunction(() => JSON.parse(localStorage.getItem('cells.garden/v1')).projects[0].flowers[0]?.content === 'Phone flower grown');
    assert((await chipState(mpage)).text === 'Phone flower grown', 'the chip should show what was written');

    await holdAt('.garden-peek-chip.is-visible');
    await mpage.waitForSelector('.garden-context-menu', { timeout: 3000 });
    const phoneChipMenu = await mpage.$$eval('.garden-context-menu > .garden-menu-item > .garden-menu-label', (els) => els.map((e) => e.textContent));
    assert.deepEqual(phoneChipMenu, await cellMenu(mpage, 'Highlight', 'flower'), 'holding the chip should open its cell\'s menu');
    const phoneEmpty = await emptySpot(mpage);
    assert(phoneEmpty, 'no empty garden to tap');
    await touch('touchStart', phoneEmpty.x, phoneEmpty.y);
    await touch('touchEnd', phoneEmpty.x, phoneEmpty.y);
    await peekGone(mpage, 'a tap on the empty garden');

    // A hold on the part itself: its chip and its cell's menu at once.
    await touch('touchStart', phoneFlower.x, phoneFlower.y);
    await mpage.waitForTimeout(600);
    await touch('touchEnd', phoneFlower.x, phoneFlower.y);
    await mpage.waitForSelector('.garden-context-menu', { timeout: 3000 });
    const heldChip = await chipState(mpage);
    const heldMenu = await mpage.$$eval('.garden-context-menu > .garden-menu-item > .garden-menu-label', (els) => els.map((e) => e.textContent));
    assert(heldChip.count === 1 && heldChip.pinned && heldChip.id === phoneFlower.itemId, `holding a part should pin its chip: ${JSON.stringify(heldChip)}`);
    assert.deepEqual(heldMenu, await cellMenu(mpage, 'Highlight', 'flower'), 'holding a part should open its cell\'s menu');
    await touch('touchStart', phoneEmpty.x, phoneEmpty.y);
    await touch('touchEnd', phoneEmpty.x, phoneEmpty.y);
    await peekGone(mpage, 'a tap on the empty garden after a hold');

    // A part under the see-through box of the part above it: the tap means the part drawn there.
    const coveredPart = await partSpot(mpage, '.garden-part[data-item-id]', { covered: true });
    if (coveredPart) {
        await touch('touchStart', coveredPart.x, coveredPart.y);
        await touch('touchEnd', coveredPart.x, coveredPart.y);
        await mpage.waitForTimeout(200);
        const under = await chipState(mpage);
        assert(under.id === coveredPart.itemId && under.markedId === coveredPart.itemId, `a tap should mean the part drawn under the finger, not the box on top: ${JSON.stringify({ coveredPart, under })}`);
        await touch('touchStart', phoneEmpty.x, phoneEmpty.y);
        await touch('touchEnd', phoneEmpty.x, phoneEmpty.y);
        await mpage.waitForFunction(() => !document.querySelector('.garden-peek-chip.is-visible'));
    } else {
        console.log('no part drawn under another part\'s box on this phone garden; skipped the pixel-true tap');
    }

    // A finger panning the garden, or two pinching it, lets a pinned chip go.
    const pinChip = async () => {
        const spot = await partSpot(mpage, '.garden-flower-part');
        assert(spot, 'no flower to pin');
        await touch('touchStart', spot.x, spot.y);
        await touch('touchEnd', spot.x, spot.y);
        await mpage.waitForSelector('.garden-peek-chip.is-visible.is-selected');
    };
    await pinChip();
    await touch('touchStart', phoneEmpty.x, phoneEmpty.y);
    await touch('touchMove', phoneEmpty.x + 10, phoneEmpty.y + 20);
    await touch('touchMove', phoneEmpty.x + 20, phoneEmpty.y + 40);
    await touch('touchEnd', phoneEmpty.x + 20, phoneEmpty.y + 40);
    await peekGone(mpage, 'a finger panning the garden');
    await mpage.waitForTimeout(500); // the camera settles
    await pinChip();
    const pinch = (spread) => [{ x: 195 - spread, y: 300, id: 0 }, { x: 195 + spread, y: 300, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinch(30) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinch(45) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinch(60) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await peekGone(mpage, 'two fingers pinching the garden');
    await mpage.waitForTimeout(500);

    // Pan view: the same chip, and it only shows: no writing in it, and a hold
    // on a part shows its chip without a menu.
    await tapAt('.garden-pan-toggle');
    await mpage.waitForSelector('.garden-pan-layer .garden-canvas-viewport', { state: 'attached' });
    await gardenSettled(mpage);
    const panFlower = await partSpot(mpage, '.garden-flower-part');
    assert(panFlower, 'no flower to tap in pan view');
    await touch('touchStart', panFlower.x, panFlower.y);
    await touch('touchEnd', panFlower.x, panFlower.y);
    await mpage.waitForTimeout(200);
    const panChip = await chipState(mpage);
    console.log('pan view chip:', panChip);
    assert(panChip.count === 1 && panChip.text === 'Phone flower grown' && panChip.inPanLayer && panChip.inView && !panChip.overlapsPart && panChip.rings === 1,
        `a tap on a flower in pan view should show its cell: ${JSON.stringify(panChip)}`);
    assert(panChip.pointer === 'none', `the chip in pan view only shows: ${JSON.stringify(panChip)}`);
    await shot(mpage, '04c-mobile-pan-peek.png');
    // What a second tap on it would be off pan view (touch.ts): a double-click.
    await mpage.$eval('.garden-peek-chip.is-visible', (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 })));
    await mpage.waitForTimeout(100);
    const panAfterDblclick = await chipState(mpage);
    assert(panAfterDblclick.count === 1 && !panAfterDblclick.editing, `the chip in pan view must not be written in: ${JSON.stringify(panAfterDblclick)}`);
    await touch('touchStart', panFlower.x, panFlower.y);
    await mpage.waitForTimeout(600);
    await touch('touchEnd', panFlower.x, panFlower.y);
    await mpage.waitForTimeout(200);
    assert(!(await mpage.$('.garden-context-menu')) && (await chipState(mpage)).count === 1, 'a hold in pan view shows the chip and no menu');
    await tapAt('.garden-pan-exit');
    await mpage.waitForFunction(() => !document.querySelector('.garden-pan-layer'));
    await peekGone(mpage, 'leaving pan view');
    await tapAt('.garden-board-toggle');
    await mpage.waitForFunction(() => document.documentElement.dataset.board === 'shown');

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
// Signed in, against a stand-in for Supabase
// ---------------------------------------------------------------------------
// Every request to the Supabase host is answered here and never goes out: a
// session in storage, a garden whose cells have people on them, the people,
// two notifications and the notify function's door. Realtime is a socket that
// never answers. Then: the pictures on the board and on the chip, the Assign
// panel and what it saves and sends, the Notifications list and where a tap on
// one leads, a cell's address, and the Notifications row in Settings on a
// desktop and on an iPhone that has not added the app to its Home Screen.

const ME = '0b9c3a52-6f1e-4c7a-9d10-000000000001';
const ANA = '0b9c3a52-6f1e-4c7a-9d10-00000000000a';
const BO = '0b9c3a52-6f1e-4c7a-9d10-00000000000b';
const CY = '0b9c3a52-6f1e-4c7a-9d10-00000000000c';
const DEE = '0b9c3a52-6f1e-4c7a-9d10-00000000000d';
/** Someone who left: nobody knows them any more. */
const GONE = '0b9c3a52-6f1e-4c7a-9d10-0000000000ff';
const OWN_GARDEN = '5d1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function supabaseUrl() {
    const env = existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8') : '';
    return /^VITE_SUPABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
}

function accountGarden() {
    const cell = (id, content, assignees) => ({ id, content, isComplete: false, ...(assignees ? { assignees } : {}) });
    const plant = (id, seed, order, zones) => ({ id, name: seed, seed, standby: false, hue: 0, order, plantType: 'plant_1', flowers: [], stem: [], roots: [], minerals: [], ...zones });
    return {
        version: 1,
        updatedAt: '2026-09-23T10:00:00.000Z',
        settings: {},
        projects: [
            plant('proj_a', 'Tomatoes', 0, {
                flowers: [cell('f_one', 'Water the tomatoes', [ANA])],
                stem: [
                    cell('s_four', 'Build the trellis', [ANA, BO, CY, DEE]),
                    cell('s_plain', 'Build the trellis'),
                    cell('s_long', 'Tie the vines to the trellis along the south fence before the rain comes', [BO, CY]),
                ],
                roots: [cell('r_gone', 'Ask about the soil', [GONE])],
                minerals: [cell('m_me', 'Buy stakes', [ME])],
            }),
            plant('proj_b', 'Beans', 1, { stem: [cell('s_free', 'Plant the beans')] }),
        ],
    };
}

/** A token shaped like Supabase's; nothing checks its signature here. */
function fakeJwt(claims) {
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.stand-in`;
}

async function standInSupabase(ctx) {
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const session = {
        access_token: fakeJwt({ sub: ME, role: 'authenticated', aud: 'authenticated', exp, email: 'iver@example.com' }),
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        expires_at: exp,
        refresh_token: 'stand-in',
        user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'iver@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    };
    const profiles = {
        [ME]: { id: ME, display_name: 'Iver', avatar_seed: 'iver-seed', avatar_drawing: null },
        [ANA]: { id: ANA, display_name: 'Ana', avatar_seed: 'ana-seed', avatar_drawing: null },
        [BO]: { id: BO, display_name: 'Bo', avatar_seed: 'bo-seed', avatar_drawing: 'd1:e' + '0000000' + '0055500' + '0555550' + '0505050' + '0555550' + '0055500' + '0000000' },
        [CY]: { id: CY, display_name: 'Cy', avatar_seed: 'cy-seed', avatar_drawing: null },
        [DEE]: { id: DEE, display_name: 'Dee', avatar_seed: 'dee-seed', avatar_drawing: null },
    };
    const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
    const state = {
        garden: accountGarden(),
        name: 'My garden',
        rev: 1,
        saves: 0,
        notified: [],
        marked: [],
        unknown: [],
        notifications: [
            { id: 'aaaaaaaa-0000-4000-8000-000000000001', actor_id: ANA, garden_id: OWN_GARDEN, plant_id: null, project_id: 'proj_b', item_id: 's_free',
                title: 'Ana assigned you', body: 'Plant the beans · Beans', created_at: ago(5), read_at: null },
            { id: 'aaaaaaaa-0000-4000-8000-000000000002', actor_id: BO, garden_id: OWN_GARDEN, plant_id: null, project_id: 'proj_a', item_id: 'f_one',
                title: 'Bo assigned you', body: 'Water the tomatoes · Tomatoes', created_at: ago(180), read_at: ago(120) },
        ],
    };
    const host = new URL(supabaseUrl()).host;
    const storageKey = `cells.garden/auth/sb-${host.split('.')[0]}-auth-token`;
    await ctx.addInitScript(({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        localStorage.setItem('cells.garden/board', localStorage.getItem('cells.garden/board') ?? 'shown');
    }, { key: storageKey, value: JSON.stringify(session) });

    // Realtime: a socket that opens and never answers.
    await ctx.routeWebSocket((url) => url.host === host, () => {});
    await ctx.route((url) => url.host === host, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const origin = req.headers().origin ?? '*';
        const headers = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
            'Access-Control-Expose-Headers': 'Content-Range',
            'Content-Type': 'application/json',
        };
        const json = (body, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const path = url.pathname;
        const select = url.searchParams.get('select') ?? '';
        const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, '') ?? null;

        if (path === '/functions/v1/notify') {
            if (JSON.parse(req.postData() ?? '{}').action === 'public-key') {
                return json({ publicKey: 'BPCHb90qxxx3fUtzDyS4oiBZC7JYm0GxaRR2eeveuT81Ibi1xvg9rnw_P0jfrqIeS43alrHAQ2rVH0Mce7_Fgag' });
            }
            state.notified.push(JSON.parse(req.postData() ?? '{}'));
            return json({ notified: 1, pushed: 0 });
        }
        if (path === '/auth/v1/token') return json(session);
        if (path === '/rest/v1/rpc/save_push_subscription') return json(null);
        if (path === '/rest/v1/push_subscriptions' && req.method() === 'DELETE') return json(null);
        if (path === '/rest/v1/gardens') {
            if (req.method() === 'PATCH') {
                const patch = JSON.parse(req.postData() ?? '{}');
                if ('name' in patch) { state.name = patch.name; return json([{ id: OWN_GARDEN }]); }
                state.garden = patch.data;
                state.rev += 1;
                state.saves += 1;
                return json([{ rev: state.rev }]);
            }
            if (select === 'id,data,updated_at,rev') return json([{ id: OWN_GARDEN, data: state.garden, updated_at: state.garden.updatedAt, rev: state.rev }]);
            if (select === 'id,name') return json(eq('user_id') === ME ? [{ id: OWN_GARDEN, name: state.name }] : []);
            if (select === 'user_id,owner_id') return json(eq('id') === OWN_GARDEN ? [{ user_id: ME, owner_id: null }] : []);
        }
        if (path === '/rest/v1/garden_members') {
            if (select.startsWith('user_id,created_at,profiles')) {
                return json(eq('garden_id') === OWN_GARDEN ? [ANA, BO, CY, DEE].map((id, i) => ({ user_id: id, created_at: ago(1000 - i), profiles: profiles[id] })) : []);
            }
            return json([]);
        }
        if (path === '/rest/v1/profiles') return json(profiles[eq('id')] ? [profiles[eq('id')]] : []);
        if (path === '/rest/v1/rpc/friends') {
            return json([ANA, BO, CY, DEE].map((id) => ({ user_id: id, display_name: profiles[id].display_name, avatar_seed: profiles[id].avatar_drawing ?? profiles[id].avatar_seed, gardens: 1, plants: 0 })));
        }
        if (path === '/rest/v1/notifications') {
            if (req.method() === 'PATCH') {
                const ids = /^in\.\((.*)\)$/.exec(url.searchParams.get('id') ?? '')?.[1]?.split(',') ?? [];
                const { read_at } = JSON.parse(req.postData() ?? '{}');
                state.marked.push(...ids);
                for (const n of state.notifications) if (ids.includes(n.id)) n.read_at = read_at;
                return route.fulfill({ status: 204, headers });
            }
            return json(state.notifications);
        }
        if (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/')) {
            if (!/^\/rest\/v1\/(push_subscriptions|plant_offers|rpc\/plant_offers_for_me)/.test(path)) state.unknown.push(`${req.method()} ${path}?${url.search}`);
            return json([]);
        }
        state.unknown.push(`${req.method()} ${path}`);
        return json({});
    });
    return state;
}

/** Where a cell's text ends and its pictures begin, and what the pictures say. */
function assigneeGeometry(page, ids) {
    return page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
        const el = [...document.querySelectorAll('.kanban-scroll-container .garden-item')].find((c) => c.dataset.id === id);
        if (!el) return [id, null];
        const stack = el.querySelector(':scope > .garden-assignees');
        const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const textRight = text ? Math.max(...[...range.getClientRects()].map((r) => r.right)) : 0;
        const box = el.getBoundingClientRect();
        const s = stack?.getBoundingClientRect();
        return [id, {
            height: Math.round(box.height),
            pictures: stack ? stack.querySelectorAll('svg').length : 0,
            more: stack?.querySelector('.garden-assignees-more')?.dataset.more ?? null,
            label: stack?.getAttribute('aria-label') ?? null,
            text: el.textContent,
            textRight,
            stack: s ? { left: s.left, right: s.right, top: s.top, bottom: s.bottom, width: s.width } : null,
            cell: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        }];
    })), ids);
}

function checkAssignees(geometry, label) {
    const { f_one: one, s_four: four, s_plain: plain, s_long: long, r_gone: gone, m_me: me } = geometry;
    assert(one && four && plain && long && gone && me, `${label}: cells missing ${JSON.stringify(geometry)}`);
    assert(one.pictures === 1 && one.label === 'Assigned to Ana', `${label}: one person: ${JSON.stringify(one)}`);
    assert(four.pictures === 3 && four.more === '+1' && four.label === 'Assigned to Ana, Bo, Cy and Dee', `${label}: four people: ${JSON.stringify(four)}`);
    assert(gone.pictures === 1 && gone.label === 'Assigned to someone', `${label}: someone who left: ${JSON.stringify(gone)}`);
    assert(me.label === 'Assigned to you', `${label}: yourself: ${JSON.stringify(me)}`);
    assert(plain.pictures === 0 && plain.stack === null, `${label}: a cell with nobody has no pictures`);
    assert(four.height === plain.height, `${label}: pictures must not make a cell taller: ${four.height} vs ${plain.height}`);
    assert(four.text === 'Build the trellis', `${label}: the count must not be part of the cell's text: ${JSON.stringify(four.text)}`);
    for (const [id, g] of Object.entries(geometry)) {
        if (!g.stack) continue;
        assert(g.textRight <= g.stack.left + 0.5, `${label}: ${id}'s text runs under its pictures: ${JSON.stringify(g)}`);
        assert(g.stack.right <= g.cell.right && g.stack.top >= g.cell.top && g.stack.bottom <= g.cell.bottom, `${label}: ${id}'s pictures leave the cell: ${JSON.stringify(g)}`);
    }
}

const rowOf = (label) => `.garden-context-menu .garden-menu-item:has(.garden-menu-label:text-is("${label}"))`;

async function accountScenario(browser, errors) {
    // --- Desktop ------------------------------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
    const state = await standInSupabase(ctx);
    const page = await ctx.newPage();
    watchErrors(page, 'account', errors);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.kanban-scroll-container .garden-item[data-id="s_four"] .garden-assignees');
    // The directory arrives a moment after the garden: the names, then the pictures.
    await page.waitForFunction(() => document.querySelector('.garden-item[data-id="s_four"] .garden-assignees')?.getAttribute('aria-label') === 'Assigned to Ana, Bo, Cy and Dee');
    const desk = await assigneeGeometry(page, ['f_one', 's_four', 's_plain', 's_long', 'r_gone', 'm_me', 's_free']);
    console.log('assignees on the board:', JSON.stringify(Object.fromEntries(Object.entries(desk).map(([id, g]) => [id, g && { pictures: g.pictures, more: g.more, height: g.height }]))));
    checkAssignees(desk, 'desktop');
    // Each picture is cut to its own circle: with one id for all, hiding the first hid them all.
    const clipIds = await page.$$eval('clipPath', (els) => els.map((e) => e.id));
    assert(clipIds.length > 5 && new Set(clipIds).size === clipIds.length, `pictures share a clip id: ${JSON.stringify(clipIds)}`);
    await shot(page, '10-assignees-desktop.png');

    // The pill counts the unread notification.
    await page.waitForSelector('.auth-pill .auth-pill-badge');
    assert.equal(await page.textContent('.auth-pill .auth-pill-badge'), '1', 'one unread notification on the pill');

    // Assign: everyone who can see the cell, you first.
    await page.click('.kanban-scroll-container .garden-item[data-id="s_free"]', { button: 'right' });
    await page.waitForSelector(rowOf('Assign'));
    assert(await page.isEnabled(rowOf('Assign')), 'Assign is open in a shared garden');
    await page.click(rowOf('Assign'));
    await page.waitForSelector('.garden-assign-panel.is-open .garden-assign-person');
    const people = await page.$$eval('.garden-assign-panel .garden-assign-person', (els) => els.map((e) => [
        e.querySelector('.garden-menu-label').textContent, e.querySelector('.garden-menu-sub')?.textContent ?? '', e.classList.contains('is-active'), !!e.querySelector('svg'),
    ]));
    assert.deepEqual(people, [['Iver', 'you', false, true], ['Ana', '', false, true], ['Bo', '', false, true], ['Cy', '', false, true], ['Dee', '', false, true]],
        'the Assign panel lists everyone who can see the cell');
    await shot(page, '11-assign-panel.png');
    const savesBefore = state.saves;
    await page.click(`.garden-assign-person[data-user-id="${ANA}"]`);
    await page.waitForFunction(() => document.querySelector('.kanban-scroll-container .garden-item[data-id="s_free"] .garden-assignees')?.getAttribute('aria-label') === 'Assigned to Ana');
    assert(await page.$eval(`.garden-assign-person[data-user-id="${ANA}"]`, (e) => e.classList.contains('is-active') && e.textContent.includes('✓')), 'Ana is checked');
    for (let i = 0; i < 50 && state.notified.length === 0; i++) await page.waitForTimeout(100);
    assert.deepEqual(state.notified, [{ recipients: [ANA], gardenId: OWN_GARDEN, projectId: 'proj_b', itemId: 's_free', text: 'Plant the beans', where: 'Beans' }],
        'assigning Ana tells her, once');
    assert(state.saves > savesBefore && state.garden.projects[1].stem[0].assignees?.[0] === ANA, 'the assignment is saved at once');
    // Yourself: saved, nobody told.
    await page.click(`.garden-assign-person[data-user-id="${ME}"]`);
    await page.waitForFunction(() => document.querySelector('.kanban-scroll-container .garden-item[data-id="s_free"] .garden-assignees')?.getAttribute('aria-label') === 'Assigned to Ana and you');
    await page.waitForTimeout(600);
    assert.equal(state.notified.length, 1, 'assigning yourself tells nobody');
    // Ana again: taken off, nobody told.
    await page.click(`.garden-assign-person[data-user-id="${ANA}"]`);
    await page.waitForFunction(() => document.querySelector('.kanban-scroll-container .garden-item[data-id="s_free"] .garden-assignees')?.getAttribute('aria-label') === 'Assigned to you');
    await page.waitForTimeout(400);
    assert.equal(state.notified.length, 1, 'taking someone off tells nobody');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.garden-context-menu'));

    // Notifications: the list, and a tap opens the cell.
    await page.click('.auth-pill');
    await page.waitForSelector(rowOf('Notifications'));
    assert.equal(await page.textContent(`${rowOf('Notifications')} .garden-menu-sub`), '1 new');
    await page.click(rowOf('Notifications'));
    await page.waitForSelector('.modal .garden-notification');
    const list = await page.$$eval('.modal .garden-notification', (els) => els.map((e) => [
        e.querySelector('.garden-notification-title').textContent, e.querySelector('.garden-notification-body').textContent, e.classList.contains('is-unread'),
        e.querySelector('.garden-notification-time').textContent,
    ]));
    assert.deepEqual(list, [['Ana assigned you', 'Plant the beans · Beans', true, '5m'], ['Bo assigned you', 'Water the tomatoes · Tomatoes', false, '3h']]);
    await shot(page, '12-notifications.png');
    await page.click('.modal .garden-notification.is-unread');
    await page.waitForFunction(() => !document.querySelector('.modal-container'));
    await page.waitForSelector('.kanban-scroll-container .garden-item[data-id="s_free"].is-selected');
    assert.deepEqual(state.marked, ['aaaaaaaa-0000-4000-8000-000000000001'], 'the tapped notification is marked read');
    await page.waitForFunction(() => !document.querySelector('.auth-pill .auth-pill-badge'));

    // A cell's address, followed with the app open, and at a cold start.
    await page.evaluate(() => { location.hash = '#cell=m_me&project=proj_a'; });
    await page.waitForSelector('.kanban-scroll-container .garden-item[data-id="m_me"].is-selected');
    assert.equal(new URL(page.url()).hash, '', 'the cell leaves the address');
    const cold = await ctx.newPage();
    watchErrors(cold, 'account cold start', errors);
    await cold.goto(`${BASE}#cell=r_gone&project=proj_a`, { waitUntil: 'load' });
    await cold.waitForSelector('.kanban-scroll-container .garden-item[data-id="r_gone"].is-selected', { timeout: 10000 });
    assert.equal(new URL(cold.url()).hash, '', 'the cell leaves the address at a cold start too');
    await cold.close();

    // With the board hidden, the cell's chip over the garden wears the same pictures.
    await page.click('.garden-board-toggle');
    await page.waitForFunction(() => document.documentElement.dataset.board === 'hidden');
    await page.evaluate(() => { location.hash = '#cell=s_four&project=proj_a'; });
    await page.waitForSelector('.garden-peek-chip.is-visible .garden-assignees');
    const chip = await page.$eval('.garden-peek-chip.is-visible', (el) => ({
        pictures: el.querySelectorAll('.garden-assignees svg').length,
        more: el.querySelector('.garden-assignees-more')?.dataset.more,
        text: el.querySelector('.garden-peek-text')?.textContent,
        whole: el.textContent,
    }));
    assert.deepEqual(chip, { pictures: 3, more: '+1', text: 'Build the trellis', whole: 'Build the trellis' }, 'the chip shows the cell\'s people');
    await shot(page, '13-chip-assignees.png');
    await page.keyboard.press('Escape');
    await page.click('.garden-board-toggle');

    // A push, as a push service delivers it: the worker shows it with the cell's address.
    const cdp = await ctx.newCDPSession(page);
    const registrations = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await page.evaluate(() => navigator.serviceWorker.ready);
    for (let i = 0; i < 50 && !registrations.some((r) => !r.isDeleted); i++) await page.waitForTimeout(100);
    const registration = registrations.find((r) => !r.isDeleted);
    assert(registration, 'no service worker registration to push to');
    await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: new URL(BASE).origin,
        registrationId: registration.registrationId,
        data: JSON.stringify({ title: 'Ana assigned you', body: 'Plant the beans · Beans', url: './#cell=s_free&project=proj_b', tag: 'cell:s_free', badge: 2 }),
    });
    let shown = [];
    for (let i = 0; i < 50 && shown.length === 0; i++) {
        await page.waitForTimeout(100);
        shown = await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.ready;
            return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url, icon: n.icon }));
        });
    }
    assert.equal(shown.length, 1, 'the worker shows every push');
    assert.equal(shown[0].title, 'Ana assigned you');
    assert.equal(shown[0].body, 'Plant the beans · Beans');
    assert.equal(shown[0].tag, 'cell:s_free');
    assert.equal(shown[0].url, `${BASE}#cell=s_free&project=proj_b`, 'the push opens the cell, on this origin');
    console.log('push shown by the worker:', shown[0]);
    // The worker's message when that notification is tapped with the app open.
    await page.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'cells-garden:open', url } })), shown[0].url);
    await page.waitForSelector('.kanban-scroll-container .garden-item[data-id="s_free"].is-selected');

    // Settings: notifications can be turned on here.
    await page.click('.auth-pill');
    await page.click(rowOf('Settings'));
    await page.waitForSelector('.garden-push-setting[data-state]');
    const deskPush = await page.$eval('.garden-push-setting', (el) => ({ state: el.dataset.state, desc: el.querySelector('.setting-item-description')?.textContent, button: el.querySelector('button')?.textContent }));
    assert.deepEqual(deskPush, { state: 'off', desc: 'When someone assigns you a cell.', button: 'Turn on' }, 'desktop: notifications can be turned on');
    await page.$eval('.garden-push-setting', (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '14-settings-desktop.png');
    // The permission-sensitive call must happen during the click, after key
    // discovery. Stand in for the external push service, not for the UI.
    await page.evaluate(() => {
        window.__pushTest = { subscription: null, gestures: [], removed: 0 };
        PushManager.prototype.getSubscription = async function () { return window.__pushTest.subscription; };
        PushManager.prototype.subscribe = function (options) {
            window.__pushTest.gestures.push(navigator.userActivation.isActive);
            const sub = {
                endpoint: 'https://web.push.apple.com/test-device', options,
                toJSON: () => ({ keys: { p256dh: 'test-device-key', auth: 'test-auth' } }),
                unsubscribe: async () => {
                    window.__pushTest.removed++;
                    window.__pushTest.subscription = null;
                    return true;
                },
            };
            window.__pushTest.subscription = sub;
            return Promise.resolve(sub);
        };
    });
    await page.click('.garden-push-setting button');
    await page.waitForSelector('.garden-push-setting[data-state="on"]');
    assert.deepEqual(await page.evaluate(() => window.__pushTest.gestures), [true], 'subscription retains the tap activation');
    await page.click('.garden-push-setting button');
    await page.waitForSelector('.garden-push-setting[data-state="off"]');
    assert.equal(await page.evaluate(() => window.__pushTest.removed), 1, 'turning off revokes the browser subscription');
    await page.keyboard.press('Escape');
    // Garden names are saved separately from the task data and survive reload.
    await page.click('.auth-pill');
    await page.click(rowOf('Rename garden'));
    await page.getByRole('textbox', { name: 'Garden name' }).fill('Kitchen garden');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.auth-pill')?.textContent.includes('Kitchen garden'));
    assert.equal(state.name, 'Kitchen garden');
    assert(state.garden.projects.length > 0, 'renaming preserves the garden data');

    // Moving a cell changes its layer and completion status together.
    await page.click('.kanban-scroll-container .garden-item[data-id="m_me"]', { button: 'right' });
    await page.click(rowOf('Move to'));
    await page.click(rowOf('Flowers'));
    await page.waitForSelector('.kanban-list[data-array="flowers"] .garden-item[data-id="m_me"]');
    assert(state.garden.projects[0].flowers.some(item => item.id === 'm_me' && item.isComplete));
    await page.click('.kanban-scroll-container .garden-item[data-id="m_me"]', { button: 'right' });
    await page.click(rowOf('Move to'));
    await page.click(rowOf('Minerals'));
    await page.waitForSelector('.kanban-list[data-array="minerals"] .garden-item[data-id="m_me"]');
    assert(state.garden.projects[0].minerals.some(item => item.id === 'm_me' && !item.isComplete));

    await page.click('.auth-pill');
    await page.click(rowOf('Settings'));
    assert.equal(await page.locator('.setting-item').filter({ hasText: 'Accessibility' }).count(), 0, 'the experimental panel is deferred');
    await page.evaluate(() => localStorage.setItem('cells.garden/high-contrast', 'true'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.auth-pill')?.textContent.includes('Kitchen garden'));
    assert.equal(await page.locator('html[data-high-contrast]').count(), 0, 'old contrast preferences are inactive during beta');
    assert.equal(await page.evaluate(() => localStorage.getItem('cells.garden/high-contrast')), 'true', 'deferral does not erase a personal preference');
    await page.click('.auth-pill');
    await page.click(rowOf('Report issue'));
    const reportPanel = page.locator('.garden-menu-panel.is-open');
    assert.equal(await reportPanel.getByRole('button', { name: 'Open a GitHub issue', exact: true }).count(), 1);
    assert.equal(await reportPanel.getByRole('button', { name: 'cells.garden@proton.me', exact: true }).count(), 1);
    assert((await reportPanel.innerText()).includes('cells.garden@proton.me'));
    await page.click(rowOf('About'));
    await page.getByRole('heading', { name: 'About cells.garden' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Support cells.garden' }).getAttribute('href'), 'https://buymeacoffee.com/cells.garden');
    assert.equal(await page.getByRole('link', { name: 'About the project' }).getAttribute('href'), 'https://cells.garden/about/');
    assert.deepEqual(state.unknown, [], 'requests the stand-in did not expect');
    await ctx.close();

    // --- iPhone in Safari, not added to the Home Screen -------------------------------
    const ictx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: IPHONE_UA, colorScheme: 'dark' });
    await standInSupabase(ictx);
    const phone = await ictx.newPage();
    watchErrors(phone, 'account iphone', errors);
    await phone.goto(BASE, { waitUntil: 'load' });
    await phone.waitForFunction(() => document.querySelector('.garden-item[data-id="s_four"] .garden-assignees')?.getAttribute('aria-label') === 'Assigned to Ana, Bo, Cy and Dee');
    await phone.$eval('.kanban-scroll-container .garden-item[data-id="s_long"]', (el) => el.scrollIntoView({ block: 'center' }));
    await phone.waitForTimeout(300);
    const iphone = await assigneeGeometry(phone, ['f_one', 's_four', 's_plain', 's_long', 'r_gone', 'm_me']);
    checkAssignees(iphone, 'iPhone');
    await shot(phone, '15-assignees-iphone.png');
    await phone.click('.auth-pill');
    await phone.click(rowOf('Settings'));
    await phone.waitForSelector('.garden-push-setting[data-state]');
    const phonePush = await phone.$eval('.garden-push-setting', (el) => ({ state: el.dataset.state, desc: el.querySelector('.setting-item-description')?.textContent, buttons: el.querySelectorAll('button').length }));
    assert.equal(phonePush.state, 'install', `iPhone in Safari: add to the Home Screen first: ${JSON.stringify(phonePush)}`);
    assert(/Home Screen/.test(phonePush.desc) && phonePush.buttons === 0, `iPhone in Safari: says how, offers no button: ${JSON.stringify(phonePush)}`);
    await phone.$eval('.garden-push-setting', (el) => el.scrollIntoView({ block: 'center' }));
    await shot(phone, '16-settings-iphone.png');
    const mobileFireflies = phone.locator('.setting-item').filter({ hasText: 'Fireflies on mobile' }).locator('input');
    assert.equal(await mobileFireflies.inputValue(), '4');
    await mobileFireflies.fill('2');
    await mobileFireflies.press('Tab');
    await phone.keyboard.press('Escape');
    await phone.waitForFunction(() => document.querySelectorAll('.garden-firefly').length === 2);

    await ictx.close();
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
    if (supabaseUrl()) {
        // The full Chromium in headless mode: the lighter headless shell has no notifications to show a push with.
        const full = await chromium.launch({ channel: 'chromium' });
        try {
            await accountScenario(full, errors);
        } finally {
            await full.close().catch(() => {});
        }
    }
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
