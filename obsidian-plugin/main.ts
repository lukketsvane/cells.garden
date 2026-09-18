/**
 * cells.garden inside Obsidian.
 *
 * The same app as the web, the PWA and the extension, in an Obsidian tab: sign
 * in with the same account and the garden syncs live with every other device.
 * Max's original plugin (obsidian/) keeps the garden in vault files instead; the
 * "Import this vault's garden" command brings that garden into the synced one.
 */
import { ItemView, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';

import '../src/core/shim';
import '../src/core/ui.css';
import '../src/core/styles.css';
import '../src/core/chrome.css';
import './plugin.css';

import type { GardenApp } from '../src/core/app';
import { bootGarden } from '../src/core/boot';
import { PLANT_FOLDER } from '../src/core/markdown';
import { mergeGarden, vaultFilesToGarden, type VaultFile } from '../src/core/vault';

const VIEW_TYPE = 'cells-garden';

class GardenTabView extends ItemView {
    garden: GardenApp | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

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

    async onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
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
        const files = this.app.vault.getFiles().filter((f: TFile) => f.path.startsWith(`${PLANT_FOLDER}/`));
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
