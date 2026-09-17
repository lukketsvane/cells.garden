import './shim';
import { AssetManager } from './assets';
import { GardenView } from './garden';
import type { Garden, GardenSettings, ProjectData } from './model';
import { DEFAULT_SETTINGS, emptyGarden } from './model';
import type { GardenStore } from './store';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

/**
 * The app shell — what `GardenPlugin` was in Obsidian. Owns the data, the
 * settings, the asset manager and the store; mounts the GardenView.
 */
export class GardenApp {
    gardenData: ProjectData[] = [];
    settings: GardenSettings = { ...DEFAULT_SETTINGS };
    assetManager = new AssetManager();
    view: GardenView | null = null;
    /** Called when a save starts/finishes; the auth pill shows it. */
    onSyncState: ((state: SyncState) => void) | null = null;

    /** When the primary store is remote, every save is mirrored here too (offline copy). */
    private mirror: GardenStore | null = null;
    private updatedAt = emptyGarden().updatedAt;
    private _unsubscribe: (() => void) | null = null;
    private _persistQueue: Promise<void> = Promise.resolve();

    constructor(public store: GardenStore) {}

    async mount(host: HTMLElement) {
        await this.loadGardenData();

        this.view = new GardenView(host, this);
        await this.view.onOpen();

        this.subscribeStore();
        window.addEventListener('pagehide', this.flush);
    }

    async unmount() {
        window.removeEventListener('pagehide', this.flush);
        this._unsubscribe?.();
        this._unsubscribe = null;
        await this.view?.onClose();
        this.view = null;
    }

    async loadGardenData() {
        const garden = await this.store.load();
        this.applyGarden(garden ?? emptyGarden());
    }

    /**
     * Switch stores at runtime (sign in / sign out). Reconciles what is in
     * memory with what the new store holds: newest `updatedAt` wins, and a
     * garden that only exists on one side is copied to the other.
     */
    async useStore(next: GardenStore, options: { mirror?: GardenStore } = {}) {
        this._unsubscribe?.();
        this._unsubscribe = null;

        const local = this.toGarden();
        this.onSyncState?.('syncing');
        let remote: Garden | null;
        try {
            remote = await next.load();
        } catch (e) {
            this.onSyncState?.('error');
            throw e;
        }

        this.store = next;
        this.mirror = options.mirror ?? null;

        const remoteEmpty = !remote || remote.projects.length === 0;
        if (remoteEmpty && local.projects.length > 0) {
            // Fresh account: upload what this device has.
            await this.persist();
        } else if (remote && remote.updatedAt > local.updatedAt) {
            this.applyGarden(remote);
            if (this.mirror) await this.mirror.save(remote).catch(() => {});
            this.onSyncState?.('synced');
        } else if (remote && remote.updatedAt < local.updatedAt) {
            await this.persist();
        } else {
            this.onSyncState?.(this.mirror ? 'synced' : 'local');
        }

        this.subscribeStore();
        this.view?.scheduleRender();
    }

    private subscribeStore() {
        // Another tab / device changed the garden: reload and re-render.
        // (Was the vault `modify` listener in Obsidian.)
        this._unsubscribe = this.store.subscribe?.((garden) => {
            this.applyGarden(garden);
            if (this.mirror) void this.mirror.save(garden).catch(() => {});
            this.view?.scheduleRender();
        }) ?? null;
    }

    private applyGarden(garden: Garden) {
        this.gardenData = garden.projects.filter(p => p && p.stem && p.flowers && p.roots && p.minerals);
        // SORT BY ORDER: Ensure columns appear in the arrangement the user chose!
        this.gardenData.sort((a, b) => (a.order || 0) - (b.order || 0));
        this.settings = { ...DEFAULT_SETTINGS, ...garden.settings };
        this.updatedAt = garden.updatedAt;
    }

    /** Persist projects + settings. Serialised so saves never interleave. */
    async saveGardenData() {
        return this.persist();
    }

    async saveSettings() {
        return this.persist();
    }

    toGarden(): Garden {
        return {
            version: 1,
            projects: this.gardenData,
            settings: this.settings,
            updatedAt: this.updatedAt,
        };
    }

    private persist(): Promise<void> {
        this.updatedAt = new Date().toISOString();
        const garden = this.toGarden();
        const run = async () => {
            if (this.mirror) await this.mirror.save(garden).catch(() => {});
            this.onSyncState?.(this.mirror ? 'syncing' : 'local');
            try {
                await this.store.save(garden);
                this.onSyncState?.(this.mirror ? 'synced' : 'local');
            } catch (e) {
                console.error('Garden Cells: save failed', e);
                this.onSyncState?.('error');
            }
        };
        this._persistQueue = this._persistQueue.then(run, run);
        return this._persistQueue;
    }

    private flush = () => {
        // Make sure a pending camera/scroll save lands before the tab goes away.
        this.view?.saveViewStateNow();
    };
}
