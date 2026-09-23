#!/usr/bin/env node
// Smoke test of the Obsidian plugin build in obsidian-plugin/. Obsidian itself
// cannot run here, so the built main.js is loaded into Chromium behind a small
// stand-in for the parts of Obsidian's API the plugin uses (Plugin, ItemView,
// Notice, the workspace and the vault). It checks that the plugin
// loads, the Open garden command puts the garden in a tab with the sign-in pill, the vault
// import command brings a Garden-Cells/ plant in, the garden keeps its device
// storage in the vault's storage (copying the old shared keys once), a plant's
// menu changes its hue, pan view lifts the garden out of its tab and back, and
// Obsidian closing the tab tears the garden down without errors. Run with
// "npm run test:obsidian".

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'obsidian-plugin');

if (process.env.OBSIDIAN_TEST_FORCE_BUILD || !existsSync(join(DIST, 'main.js'))) {
    execSync('npm run build:obsidian', { cwd: ROOT, stdio: 'inherit' });
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
assert(manifest.id === 'cells-garden', `unexpected plugin id ${manifest.id}`);
assert(manifest.id !== 'garden-cells', "must not clash with Max's plugin id");
const mainJs = readFileSync(join(DIST, 'main.js'), 'utf8');
const css = readFileSync(join(DIST, 'styles.css'), 'utf8');
assert(!/import\.meta\.glob/.test(mainJs), 'main.js still contains an unresolved import.meta.glob');
assert(/require\(["']obsidian["']\)/.test(mainJs), 'main.js should require obsidian at runtime');
assert(!/navigator\.clipboard|\.clipboardData\b/.test(mainJs), 'Obsidian build must not access the system clipboard');
assert(!/loadLocalStorage|saveLocalStorage/.test(mainJs), 'Obsidian build must use Plugin.loadData/saveData instead of legacy local storage APIs');
assert(!/\blocalStorage\b/.test(mainJs), 'Obsidian build, including dependencies, must not access localStorage');
assert(/privacy\/oauth-return\.html\?target=obsidian/.test(mainJs), 'Obsidian Google sign-in must return through the website bridge');
assert(
    /\.kanban-scroll-container\s+\.project-column\s*\{[^}]*display:\s*flex/s.test(css),
    'Obsidian must ship the compact per-plant kanban layout'
);
assert(
    !/\.kanban-scroll-container\s+\.project-column\s*\{[^}]*grid-template-rows:\s*subgrid/s.test(css),
    'Obsidian still ships the shared-row kanban spacing'
);
console.log(`test-obsidian: manifest ok, main.js ${Math.round(mainJs.length / 1024)} kB, styles.css ${Math.round(css.length / 1024)} kB`);

const PLANT_MD = `---
id: proj_vault_1
type: garden-cell
seed: "From the vault"
hue: 40
order: 0
plantType: plant_1
images:
  flowers: []
  stem: []
  roots: []
  minerals: []
---
`;

// The parts of Obsidian's API the plugin touches.
const STUB = `
window.__notices = [];
window.__commands = [];
const views = {};
class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    async loadData() { return structuredClone(window.__pluginData ?? {}); }
    async saveData(data) { window.__pluginData = structuredClone(data); }
    registerView(type, factory) { views[type] = factory; }
    addRibbonIcon() { return document.createElement('div'); }
    addCommand(cmd) { window.__commands.push(cmd); }
    registerObsidianProtocolHandler(action, handler) { window.__protocol = { action, handler }; }
}
class ItemView {
    constructor(leaf) {
        this.leaf = leaf;
        this.app = leaf.app;
        this.containerEl = document.createElement('div');
        this.containerEl.className = 'workspace-leaf-content';
        this.containerEl.style.cssText = 'position: absolute; inset: 0;';
        document.body.appendChild(this.containerEl);
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'view-content';
        this.contentEl.style.cssText = 'width: 100%; height: 100%;';
        this.containerEl.appendChild(this.contentEl);
    }
}
class Notice { constructor(message) { window.__notices.push(message); } }
class TFile { constructor(path) { this.path = path; } }
class TFolder { constructor(path, children) { this.path = path; this.children = children; } }
class Vault {
    static recurseChildren(root, cb) {
        cb(root);
        for (const child of root.children ?? []) Vault.recurseChildren(child, cb);
    }
}
const obsidian = { Plugin, ItemView, Notice, TFile, TFolder, Vault };
const folders = {
    'Garden-Cells': new TFolder('Garden-Cells', [new TFile('Garden-Cells/From the vault.md')]),
    Notes: new TFolder('Notes', [new TFile('Notes/unrelated.md')]),
};
const leaves = [];
window.__app = {
    // Max's plugin is on in this stand-in, so the clash warning must show.
    plugins: { enabledPlugins: new Set(['garden-cells']) },
    workspace: {
        getLeavesOfType: (type) => leaves.filter((l) => l.type === type),
        getLeaf: () => {
            const leaf = {
                app: window.__app, type: null, view: null,
                async setViewState(state) {
                    this.type = state.type;
                    this.view = views[state.type](this);
                    leaves.push(this);
                    await this.view.onOpen();
                },
            };
            return leaf;
        },
        revealLeaf: async () => {},
        onLayoutReady: (callback) => callback(),
        detachLeavesOfType: async (type) => {
            for (const leaf of leaves.filter((l) => l.type === type)) {
                await leaf.view.onClose();
                leaf.view.containerEl.remove();
                leaves.splice(leaves.indexOf(leaf), 1);
            }
        },
    },
    vault: {
        getAbstractFileByPath: (path) => folders[path] ?? null,
        readBinary: async () => new TextEncoder().encode(window.__plantMd).buffer,
    },
};
window.require = (name) => {
    if (name === 'obsidian') return obsidian;
    throw new Error('unexpected require: ' + name);
};
`;

const errors = [];
const browser = await chromium.launch();
let failure = null;
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (/Failed to fetch|Failed to load resource|ERR_/.test(text)) return; // offline Supabase is fine
        errors.push(`console: ${text}`);
    });
    // A real origin, with browser storage forbidden: plugin data is the only persistence.
    await page.route('http://obsidian.test/**', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>',
    }));
    await page.goto('http://obsidian.test/');
    await page.evaluate(() => {
        window.__storageTouches = [];
        for (const key of ['localStorage', 'sessionStorage']) {
            Object.defineProperty(window, key, { get() {
                window.__storageTouches.push(key);
                throw new Error('Browser storage is unavailable in this host');
            } });
        }
    });
    await page.addStyleTag({ content: css });
    await page.evaluate((md) => { window.__plantMd = md; }, PLANT_MD);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: `var module = { exports: {} }; var exports = module.exports;\n${mainJs}\nwindow.__Plugin = module.exports.default || module.exports;` });

    // Plugin data is the only persistence surface for this build.
    await page.evaluate(() => {
        window.__pluginData = { local: { 'cells.garden/scene': 'mountains' } };
    });
    const commands = await page.evaluate(async () => {
        const plugin = new window.__Plugin(window.__app, { id: 'cells-garden' });
        window.__plugin = plugin;
        await plugin.onload();
        return window.__commands.map((c) => c.id);
    });
    console.log('test-obsidian: commands', commands);
    const warned = await page.evaluate(() => window.__notices.some((n) => /original plugin/.test(n)));
    assert(warned, "with Max's plugin on, a notice should say the two clash");
    await page.evaluate(() => { window.__notices.length = 0; });
    const pluginScene = await page.evaluate(() => window.__pluginData?.local?.['cells.garden/scene']);
    assert(pluginScene === 'mountains', `the scene should come from Plugin.loadData: ${pluginScene}`);
    assert(commands.includes('open') && commands.includes('import-vault-garden'), 'expected the open and import commands');
    const protocolAction = await page.evaluate(() => window.__protocol?.action ?? null);
    assert(protocolAction === 'cells-garden', `Obsidian protocol handler must register cells-garden, got ${protocolAction}`);

    await page.evaluate(async () => { await window.__commands.find((c) => c.id === 'open').callback(); });
    await page.waitForSelector('.cells-garden-host .garden-canvas-viewport', { timeout: 15000 });
    const shell = await page.evaluate(() => {
        const host = document.querySelector('.cells-garden-host');
        const pill = host.querySelector('.auth-pill');
        return {
            pill: pill ? getComputedStyle(pill).position : null,
            pillText: pill?.textContent?.trim() ?? null,
            canvas: host.querySelector('.garden-canvas-viewport').getBoundingClientRect().height,
            parts: host.querySelectorAll('.garden-stem-container').length,
            groundRatio: (() => {
                const viewport = host.querySelector('.garden-canvas-viewport')?.getBoundingClientRect();
                const plant = host.querySelector('.garden-plant-wrapper')?.getBoundingClientRect();
                return viewport && plant ? (plant.top - viewport.top) / viewport.height : null;
            })(),
        };
    });
    console.log('test-obsidian: garden in a tab', shell);
    assert(shell.pill === 'absolute', `the sign-in pill should sit in the tab, got position ${shell.pill}`);
    assert(shell.pillText === 'Sign in', `the pill should offer sign-in: ${shell.pillText}`);
    assert(shell.canvas > 100, 'the canvas has no height');
    if (shell.groundRatio !== null) {
        assert(shell.groundRatio > 0.42 && shell.groundRatio < 0.86,
            `the Obsidian garden horizon is misplaced: ${shell.groundRatio}`);
    }

    await page.evaluate(async () => { await window.__commands.find((c) => c.id === 'import-vault-garden').callback(); });
    await page.waitForFunction(() => [...document.querySelectorAll('.seed-content')].some((el) => el.textContent === 'From the vault'), null, { timeout: 5000 });
    const notices = await page.evaluate(() => window.__notices);
    console.log('test-obsidian: import notice', notices);
    assert(notices.some((n) => /1 new/.test(n)), `the import should report one new plant: ${JSON.stringify(notices)}`);
    await page.waitForFunction(() => (window.__pluginData?.local?.['cells.garden/v1'] ?? '').includes('From the vault'));
    const stored = await page.evaluate(() => window.__pluginData?.local?.['cells.garden/v1'] ?? '');
    assert(stored.includes('From the vault'), 'the garden should be kept with Plugin.saveData');
    assert(await page.evaluate(() => document.documentElement.dataset.scene) === 'mountains', 'the copied scene should apply');

    // The plant's menu runs in the plugin build too: its hue field writes through to Plugin.saveData.
    const hueRow = '.garden-context-menu > .garden-menu-item:has-text("Plant hue")';
    await page.click('.seed-content:text-is("From the vault")', { button: 'right' });
    await page.waitForSelector('.garden-context-menu');
    await page.click(hueRow);
    assert(await page.getAttribute(hueRow, 'aria-expanded') === 'true', 'the hue row should open its field in the menu');
    await page.fill('.garden-menu-hue-field', '120');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /"hue":120\b/.test(window.__pluginData?.local?.['cells.garden/v1'] ?? ''));
    assert((await page.$('.garden-context-menu')) === null, 'Enter should close the plant menu');
    console.log('test-obsidian: plant hue saved from the menu');

    // Pan view lifts the garden out of its tab, even out of a leaf that traps
    // position: fixed (a transform does, as Obsidian's leaves can), over the
    // whole window, and puts it back exactly where it was.
    const pan = await page.evaluate(async () => {
        const leaf = document.querySelector('.workspace-leaf-content');
        leaf.style.inset = '60px 0 40px 0';
        leaf.style.transform = 'translateZ(0)';
        const host = document.querySelector('.cells-garden-host');
        const content = host.querySelector(':scope > .view-content');
        const next = content.nextSibling;
        const canvas = () => content.querySelector('.garden-canvas-viewport').getBoundingClientRect();
        const before = canvas().height;
        // The button shows on touch screens only; this window has a mouse.
        host.querySelector('.garden-pan-toggle').click();
        const layer = document.querySelector('body > .garden-pan-layer');
        const r = canvas();
        const open = {
            lifted: !!layer && layer.contains(content) && !host.contains(content),
            canvas: [r.left, r.top, r.width, r.height],
            window: [0, 0, innerWidth, innerHeight],
        };
        layer?.querySelector('.garden-pan-exit')?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
            open,
            back: content.parentNode === host && content.nextSibling === next,
            layerGone: !document.querySelector('.garden-pan-layer'),
            canvas: [before, canvas().height],
        };
    });
    console.log('test-obsidian: pan view', pan);
    assert(pan.open.lifted, 'pan view should lift the garden out of its tab');
    assert.deepEqual(pan.open.canvas, pan.open.window, 'pan view should cover the whole window, not the leaf');
    assert(pan.back && pan.layerGone, 'leaving pan view should put the garden back where it was');
    assert(Math.abs(pan.canvas[0] - pan.canvas[1]) <= 1, `the garden pane changed size after pan view: ${pan.canvas}`);

    // Obsidian closes the tab (the plugin must not detach it itself on unload).
    assert(await page.evaluate(() => typeof window.__plugin.onunload !== 'function' || !/detachLeaves/.test(String(window.__plugin.onunload))), 'onunload must not detach leaves');
    await page.evaluate(async () => { await window.__app.workspace.detachLeavesOfType('cells-garden'); });
    assert((await page.$('.cells-garden-host')) === null, 'closing the tab should remove the garden');
    assert.deepEqual(await page.evaluate(() => window.__storageTouches), [], 'plugin and dependencies must never probe browser storage');
    await page.waitForTimeout(300);
} catch (e) {
    failure = e;
} finally {
    await browser.close();
}

if (failure) console.error(`test-obsidian: FAILED: ${failure.stack ?? failure.message}`);
if (errors.length) console.error(`test-obsidian: unexpected errors:\n  ${errors.join('\n  ')}`);
if (failure || errors.length) process.exit(1);
console.log('test-obsidian: ok');
