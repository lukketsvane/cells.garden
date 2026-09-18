#!/usr/bin/env node
// Smoke test of the Obsidian plugin build in obsidian-plugin/. Obsidian itself
// cannot run here, so the built main.js is loaded into Chromium behind a small
// stand-in for the parts of Obsidian's API the plugin uses (Plugin, ItemView,
// Notice, PluginSettingTab, the workspace and the vault). It checks that the plugin
// loads, the Open garden command puts the garden in a tab with the sign-in pill, the
// settings tab draws the garden's settings and a change reaches the garden, the vault
// import command brings a Garden-Cells/ plant in, the garden keeps its device
// storage in the vault's storage (copying the old shared keys once), and Obsidian
// closing the tab tears the garden down without errors. Run with "npm run test:obsidian".

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
    registerView(type, factory) { views[type] = factory; }
    addRibbonIcon() { return document.createElement('div'); }
    addCommand(cmd) { window.__commands.push(cmd); }
    addSettingTab(tab) { window.__settingTab = tab; }
}
class PluginSettingTab {
    constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); }
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
const obsidian = { Plugin, ItemView, Notice, PluginSettingTab, TFile, TFolder, Vault };
const folders = {
    'Garden-Cells': new TFolder('Garden-Cells', [new TFile('Garden-Cells/From the vault.md')]),
    Notes: new TFolder('Notes', [new TFile('Notes/unrelated.md')]),
};
const leaves = [];
window.__app = {
    // Max's plugin is on in this stand-in, so the clash warning must show.
    plugins: { enabledPlugins: new Set(['garden-cells']) },
    // As Obsidian does it: JSON under the vault's id.
    loadLocalStorage(key) {
        const raw = localStorage.getItem('testvault-' + key);
        return raw === null ? null : JSON.parse(raw);
    },
    saveLocalStorage(key, data) {
        if (data === null) localStorage.removeItem('testvault-' + key);
        else localStorage.setItem('testvault-' + key, JSON.stringify(data));
    },
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
    // A real origin, so localStorage works as it does in Obsidian.
    await page.route('http://obsidian.test/**', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>',
    }));
    await page.goto('http://obsidian.test/');
    await page.addStyleTag({ content: css });
    await page.evaluate((md) => { window.__plantMd = md; }, PLANT_MD);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: `var module = { exports: {} }; var exports = module.exports;\n${mainJs}\nwindow.__Plugin = module.exports.default || module.exports;` });

    // What an earlier version kept in the shared localStorage.
    await page.evaluate(() => localStorage.setItem('cells.garden/scene', 'mountains'));
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
    const copied = await page.evaluate(() => ({
        vault: localStorage.getItem('testvault-cells.garden/scene'),
        old: localStorage.getItem('cells.garden/scene'),
    }));
    assert(copied.vault === '"mountains"', `the old shared keys should be copied into the vault storage: ${copied.vault}`);
    assert(copied.old === 'mountains', 'the old shared keys must stay');
    assert(commands.includes('open') && commands.includes('import-vault-garden'), 'expected the open and import commands');

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
        };
    });
    console.log('test-obsidian: garden in a tab', shell);
    assert(shell.pill === 'absolute', `the sign-in pill should sit in the tab, got position ${shell.pill}`);
    assert(shell.pillText === 'Sign in', `the pill should offer sign-in: ${shell.pillText}`);
    assert(shell.canvas > 100, 'the canvas has no height');

    // The settings tab draws the open garden's settings, and a change reaches the garden.
    const tab = await page.evaluate(() => {
        const t = window.__settingTab;
        t.display();
        const fireflies = [...t.containerEl.querySelectorAll('.setting-item')].find((el) => el.textContent.startsWith('Fireflies'));
        const input = fireflies.querySelector('input');
        input.value = '2';
        input.dispatchEvent(new Event('change'));
        return { bar: !!t.containerEl.querySelector('.garden-sky-bar'), nodes: t.containerEl.querySelectorAll('.garden-sky-node').length };
    });
    console.log('test-obsidian: settings tab', tab);
    assert(tab.bar && tab.nodes === 6, `the settings tab should show the sky bar and six nodes: ${JSON.stringify(tab)}`);
    await page.waitForFunction(() => document.querySelectorAll('.cells-garden-host .garden-firefly').length === 2, null, { timeout: 5000 });

    await page.evaluate(async () => { await window.__commands.find((c) => c.id === 'import-vault-garden').callback(); });
    await page.waitForFunction(() => [...document.querySelectorAll('.seed-content')].some((el) => el.textContent === 'From the vault'), null, { timeout: 5000 });
    const notices = await page.evaluate(() => window.__notices);
    console.log('test-obsidian: import notice', notices);
    assert(notices.some((n) => /1 new/.test(n)), `the import should report one new plant: ${JSON.stringify(notices)}`);
    const stored = await page.evaluate(() => ({
        vault: localStorage.getItem('testvault-cells.garden/v1') ?? '',
        shared: localStorage.getItem('cells.garden/v1'),
    }));
    assert(stored.vault.includes('From the vault'), 'the garden should be kept in the vault storage');
    assert(stored.shared === null, 'the garden should not be kept in the shared localStorage');
    assert(await page.evaluate(() => document.documentElement.dataset.scene) === 'mountains', 'the copied scene should apply');

    // Obsidian closes the tab (the plugin must not detach it itself on unload).
    assert(await page.evaluate(() => typeof window.__plugin.onunload !== 'function' || !/detachLeaves/.test(String(window.__plugin.onunload))), 'onunload must not detach leaves');
    await page.evaluate(async () => { await window.__app.workspace.detachLeavesOfType('cells-garden'); });
    assert((await page.$('.cells-garden-host')) === null, 'closing the tab should remove the garden');
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
