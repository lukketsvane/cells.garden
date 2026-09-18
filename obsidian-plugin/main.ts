/**
 * cells.garden inside Obsidian.
 *
 * The same app as the web, the PWA and the extension, in an Obsidian tab: sign
 * in with the same account and the garden syncs live with every other device.
 * Max's original plugin (the `original` branch) keeps the garden in vault files; the
 * "Import this vault's garden" command brings that garden into the synced one.
 */
import { ItemView, Notice, Plugin, TFile, TFolder, Vault } from 'obsidian';

import '../src/core/shim';
import '../src/core/styles.css';
import '../src/core/chrome.css';
import './plugin.css';

import type { GardenApp } from '../src/core/app';
import { bootGarden } from '../src/core/boot';
import { LOCAL_PREFIX, setLocalBackend } from '../src/core/local';
import { PLANT_FOLDER } from '../src/core/markdown';
import { CLAIM_KEY } from '../src/core/store';
import { mergeGarden, vaultFilesToGarden, type VaultFile } from '../src/core/vault';

const VIEW_TYPE = 'cells-garden';
/** Set in a vault's storage once the shared localStorage keys were copied into it. */
const COPIED_KEY = `${LOCAL_PREFIX}vault-copied`;

class GardenTabView extends ItemView {
    garden: GardenApp | null = null;

    getViewType() {
        return VIEW_TYPE;
    }

    getDisplayText() {
        return 'cells.garden';
    }

    getIcon() {
        return 'sprout';
    }

    async onOpen() {
        const host = this.contentEl;
        host.empty();
        host.addClass('cells-garden-host');
        this.garden = await bootGarden(host);
    }

    async onClose() {
        await this.garden?.unmount();
        this.garden = null;
    }
}

export default class CellsGardenPlugin extends Plugin {
    async onload() {
        this.useVaultStorage();
        this.registerView(VIEW_TYPE, (leaf) => new GardenTabView(leaf));
        this.addRibbonIcon('sprout', 'Open cells.garden', () => void this.openGarden());
        this.addCommand({ id: 'open', name: 'Open garden', callback: () => void this.openGarden() });
        this.addCommand({
            id: 'import-vault-garden',
            name: `Import this vault's garden (${PLANT_FOLDER}/)`,
            callback: () => void this.importVaultGarden(),
        });
        // Max's original plugin styles the same class names globally; with both on, the scene breaks.
        this.app.workspace.onLayoutReady(() => {
            const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
            if (plugins?.enabledPlugins?.has('garden-cells')) {
                new Notice('Garden Cells (the original plugin) is on too. Its styles clash with cells.garden: turn it off under Community plugins.', 12000);
            }
        });
    }


    /**
     * Keep the garden's device storage per vault. Earlier versions used the
     * shared localStorage: copy those keys in once, and leave them in place.
     */
    private useVaultStorage() {
        const app = this.app;
        const get = (key: string): string | null => {
            const value: unknown = app.loadLocalStorage(key);
            return typeof value === 'string' ? value : null;
        };
        const shared = window.localStorage;
        try {
            if (get(COPIED_KEY) === null) {
                const keys: string[] = [];
                for (let i = 0; i < shared.length; i++) {
                    const key = shared.key(i);
                    if (key?.startsWith(LOCAL_PREFIX)) keys.push(key);
                }
                for (const key of keys) {
                    if (get(key) === null) app.saveLocalStorage(key, shared.getItem(key));
                }
                app.saveLocalStorage(COPIED_KEY, '1');
            }
            // The anonymous-garden claim is device-wide: every vault shares one sign-in.
            const claim = get(CLAIM_KEY);
            if (claim !== null && shared.getItem(CLAIM_KEY) === null) shared.setItem(CLAIM_KEY, claim);
        } catch (e) {
            console.error('cells.garden: could not copy device storage into this vault', e);
        }
        setLocalBackend({
            get: (key) => (key === CLAIM_KEY ? (shared.getItem(key) ?? get(key)) : get(key)),
            set: (key, value) => {
                app.saveLocalStorage(key, value);
                if (key === CLAIM_KEY) shared.setItem(key, value);
            },
            remove: (key) => {
                if (key === CLAIM_KEY) shared.removeItem(key);
                app.saveLocalStorage(key, null);
            },
        });
    }

    private async openGarden(): Promise<GardenTabView | null> {
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        await this.app.workspace.revealLeaf(leaf);
        return leaf.view instanceof GardenTabView ? leaf.view : null;
    }

    /** Fold the plants Max's plugin keeps as markdown files into the synced garden. */
    private async importVaultGarden() {
        const folder = this.app.vault.getAbstractFileByPath(PLANT_FOLDER);
        const files: TFile[] = [];
        if (folder instanceof TFolder) {
            Vault.recurseChildren(folder, (file) => {
                if (file instanceof TFile) files.push(file);
            });
        }
        if (files.length === 0) {
            new Notice(`No ${PLANT_FOLDER}/ folder in this vault.`);
            return;
        }
        const view = await this.openGarden();
        const garden = view?.garden;
        if (!garden) {
            new Notice('Open the garden first.');
            return;
        }
        const vaultFiles: VaultFile[] = [];
        for (const file of files) {
            vaultFiles.push({ path: file.path, bytes: new Uint8Array(await this.app.vault.readBinary(file)) });
        }
        const result = vaultFilesToGarden(vaultFiles);
        const { garden: merged, summary } = mergeGarden(garden.toGarden(), result, 'merge');
        await garden.replaceGarden(merged);
        new Notice(`Imported: ${summary.added} new, ${summary.updated} updated.`);
    }
}
