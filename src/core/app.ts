import './shim';
import { AssetManager } from './assets';
import { GardenView } from './garden';
import type { Garden, GardenSettings, ProjectData } from './model';
import { DEFAULT_SETTINGS, emptyGarden } from './model';
import type { GardenStore } from './store';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

export interface UseStoreOptions {
    /** When the primary store is remote, every save is mirrored here too (offline copy). */
    mirror?: GardenStore;
    /**
     * A garden to offer to an account that has nothing yet (the device's anonymous
     * garden on first sign-in). Used only when neither the cloud nor the mirror has plants.
     */
    seed?: Garden | null;
    /** Called when `seed` was uploaded, so the caller can mark it as claimed. */
    onSeedUsed?: () => void;
    /**
     * false = just show what the store has, never write during the switch
     * (sign-out: the signed-in garden must not leak into the anonymous store).
     */
    reconcile?: boolean;
}

/**
 * The app shell, what `GardenPlugin` was in Obsidian. Owns the data, the
 * settings, the asset manager and the store; mounts the GardenView.
 */
export class GardenApp {
    gardenData: ProjectData[] = [];
    settings: GardenSettings = { ...DEFAULT_SETTINGS };
    assetManager = new AssetManager();
    view: GardenView | null = null;
    /** Called when a save starts/finishes; the auth pill shows it. */
    onSyncState: ((state: SyncState) => void) | null = null;

    private mirror: GardenStore | null = null;
    private updatedAt = emptyGarden().updatedAt;
    private _unsubscribe: (() => void) | null = null;
    private _persistQueue: Promise<void> = Promise.resolve();
    private _retryOnline: (() => void) | null = null;

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
        this.clearRetry();
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
     * Switch stores at runtime (sign in / sign out). Single-flighted across
     * same-origin pages, because sign-in is broadcast to every open tab and two
     * pages reconciling at once could both create a garden for a fresh account.
     */
    async useStore(next: GardenStore, options: UseStoreOptions = {}) {
        this.clearRetry();
        const run = () => this.switchStore(next, options);
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            await navigator.locks.request('cells.garden/switch-store', run);
        } else {
            await run();
        }
    }

    private async switchStore(next: GardenStore, options: UseStoreOptions) {
        this._unsubscribe?.();
        this._unsubscribe = null;

        const seed = options.seed ?? null;
        this.onSyncState?.('syncing');

        let remote: Garden | null;
        try {
            remote = await next.load();
        } catch (e) {
            // Keep the current store working (and listening) and try again when the network returns.
            this.subscribeStore();
            this.onSyncState?.('error');
            this.retryWhenOnline(next, options);
            throw e;
        }

        this.store = next;
        this.mirror = options.mirror ?? null;

        if (options.reconcile === false) {
            this.applyGarden(remote ?? emptyGarden());
            this.onSyncState?.(this.mirror ? 'synced' : 'local');
        } else {
            const mine = this.mirror ? await this.mirror.load().catch(() => null) : null;
            let chosen: Garden;
            let pushToRemote = false;

            if (remote && mine && mine.updatedAt > remote.updatedAt) {
                // This device edited the account's garden offline: it is the newest copy.
                chosen = mine;
                pushToRemote = true;
            } else if (remote) {
                chosen = remote;
            } else if (mine && mine.projects.length > 0) {
                chosen = mine;
                pushToRemote = true;
            } else if (seed && seed.projects.length > 0) {
                // Fresh account: it receives the anonymous garden of this device, once.
                chosen = seed;
                pushToRemote = true;
                options.onSeedUsed?.();
            } else {
                chosen = remote ?? mine ?? emptyGarden();
            }

            this.applyGarden(chosen);
            if (pushToRemote) {
                await this.persist();
            } else {
                if (this.mirror) await this.mirror.save(chosen).catch(() => {});
                this.onSyncState?.(this.mirror ? 'synced' : 'local');
            }
        }

        this.subscribeStore();
        this.view?.scheduleRender();
    }

    private retryWhenOnline(next: GardenStore, options: UseStoreOptions) {
        const retry = () => {
            this._retryOnline = null;
            this.useStore(next, options).catch(() => {});
        };
        this._retryOnline = retry;
        window.addEventListener('online', retry, { once: true });
    }

    private clearRetry() {
        if (this._retryOnline) {
            window.removeEventListener('online', this._retryOnline);
            this._retryOnline = null;
        }
    }

    private subscribeStore() {
        this._unsubscribe?.();
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

    /**
     * Swap in a whole garden, which is what importing a vault or a backup does. The
     * result is saved immediately, so it carries a fresh `updatedAt` and wins
     * over whatever the cloud is holding.
     */
    async replaceGarden(garden: Garden): Promise<void> {
        this.applyGarden(garden);
        this.view?.scheduleRender();
        await this.saveGardenData();
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
