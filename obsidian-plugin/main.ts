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

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GardenApp } from '../src/core/app';
import { bootGarden } from '../src/core/boot';
import { setLocalBackend } from '../src/core/local';
import { PLANT_FOLDER } from '../src/core/markdown';
import { mergeGarden, vaultFilesToGarden, type VaultFile } from '../src/core/vault';

const VIEW_TYPE = 'cells-garden';
/** Supabase is always allowed to return to the website; that page deep-links the code back here. */
const RETURN_URL = 'https://cells.garden/privacy/oauth-return.html?target=obsidian';
function protocolValue(value: string | undefined, max: number): string | null {
    if (!value || value.length > max) return null;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return null;
    }
    return value;
}
/** The open garden's sign-in client, which holds the code verifier Google's answer is checked against. */
let client: SupabaseClient | null = null;

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
        this.garden = await bootGarden(host, {
            redirectTo: RETURN_URL,
            // Google's page opens in the system browser; it comes back through the protocol handler.
            openOAuth: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
            onClient: (c) => { client = c; },
        });
    }

    async onClose() {
        await this.garden?.unmount();
        this.garden = null;
    }
}

interface CellsGardenPluginData {
    local?: Record<string, string>;
}

export default class CellsGardenPlugin extends Plugin {
    private pluginData: CellsGardenPluginData = {};
    private localValues: Record<string, string> = {};
    private saveTail: Promise<void> = Promise.resolve();

    async onload() {
        await this.usePluginStorage();
        this.registerView(VIEW_TYPE, (leaf) => new GardenTabView(leaf));
        this.registerObsidianProtocolHandler('cells-garden', (params) => void this.finishSignIn(params));
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
     * Keep all device state in Obsidian's plugin data file. The core expects a
     * synchronous key/value backend, so reads and writes hit an in-memory mirror
     * and each mutation queues a Plugin.saveData snapshot.
     */
    private async usePluginStorage() {
        const loaded = await this.loadData() as CellsGardenPluginData | null;
        this.pluginData = loaded && typeof loaded === 'object' ? loaded : {};

        const values: Record<string, string> = {};
        if (this.pluginData.local && typeof this.pluginData.local === 'object') {
            for (const [key, value] of Object.entries(this.pluginData.local)) {
                if (typeof value === 'string') values[key] = value;
            }
        }
        this.localValues = values;

        const persist = () => {
            const snapshot: CellsGardenPluginData = {
                ...this.pluginData,
                local: { ...this.localValues },
            };
            this.pluginData = snapshot;
            this.saveTail = this.saveTail
                .catch(() => {})
                .then(() => this.saveData(snapshot))
                .catch((e) => { console.error('cells.garden: could not save plugin data', e); });
        };

        setLocalBackend({
            get: (key) => this.localValues[key] ?? null,
            set: (key, value) => {
                this.localValues[key] = value;
                persist();
            },
            remove: (key) => {
                delete this.localValues[key];
                persist();
            },
        });
    }

    /** The browser is back from Google with a code (or an error): trade it for a session. */
    private async finishSignIn(params: Record<string, string>) {
        const code = protocolValue(params.code, 4096);
        const protocolError = protocolValue(params.error, 256);
        const errorDescription = protocolValue(params.error_description, 1024);
        if ((code && protocolError) || (params.code && !code) || (params.error && !protocolError)) {
            new Notice('Could not finish sign-in. The return data was invalid.');
            return;
        }
        if (protocolError) {
            new Notice(`Google sign-in did not finish: ${errorDescription ?? protocolError}`);
            return;
        }
        if (!code) return;

        // The callback can arrive after the garden tab was closed. Reopen it so
        // the same Supabase client (and its stored PKCE verifier) is available.
        if (!client) await this.openGarden();
        const auth = client;
        if (!auth) {
            new Notice('Could not finish sign-in. Open cells.garden and try again.');
            return;
        }
        const { error } = await auth.auth.exchangeCodeForSession(code);
        new Notice(error ? `Could not sign in: ${error.message}` : 'Signed in.');
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
