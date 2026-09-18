import './shim';
import { AssetManager } from './assets';
import { GardenView } from './garden';
import { mergeGardens } from './merge';
import type { Garden, GardenSettings, ProjectData } from './model';
import { defaultSettings, emptyGarden, settingsFrom } from './model';
import { GardenGoneError, readJson, snapshot, writeJson, type GardenStore } from './store';

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

const FRIEND_PLANTS_KEY = 'cells.garden/friend-plants';

/**
 * The app shell, what `GardenPlugin` was in Obsidian. Owns the data, the
 * settings, the asset manager and the store; mounts the GardenView.
 */
export class GardenApp {
    gardenData: ProjectData[] = [];
    settings: GardenSettings = defaultSettings();
    assetManager = new AssetManager();
    view: GardenView | null = null;
    /** Called when a save starts/finishes; the auth pill shows it. */
    onSyncState: ((state: SyncState) => void) | null = null;
    /** Set when sharing is possible: opens sharing for one plant. */
    onSharePlant: ((projectId: string) => void) | null = null;
    /** Called when the open garden is no longer reachable (a shared garden left or revoked). */
    onGone: (() => void) | null = null;
    /** Called whenever a garden is put on screen: loaded, switched, synced in or merged. */
    onGardenApplied: (() => void) | null = null;
    /** Also told when a garden is applied: open settings panels redraw from it. */
    readonly settingsWatchers = new Set<() => void>();
    /** Called after a save of this device's edits has been handed to the store. */
    onPersisted: (() => void) | null = null;

    private mirror: GardenStore | null = null;
    /**
     * The last garden the store is known to hold. An incoming change is merged
     * against it, so edits made here and not saved yet survive the arrival.
     */
    private synced: Garden | null = null;
    private updatedAt = emptyGarden().updatedAt;
    private _unsubscribe: (() => void) | null = null;
    private _persistQueue: Promise<void> = Promise.resolve();
    private _retryOnline: (() => void) | null = null;

    constructor(public store: GardenStore) {}

    /**
     * Shared plants someone else owns, by their plants row id. They stand to
     * either side of the user's own plants, so the garden reads as yours in the
     * middle with your friends' plants at its borders. Remembered on the device,
     * so the garden opens already arranged.
     */
    friendPlants = new Set<string>(readJson<string[]>(FRIEND_PLANTS_KEY) ?? []);

    isFriendPlant(project: ProjectData): boolean {
        return !!project.sharedPlantId && this.friendPlants.has(project.sharedPlantId);
    }

    /** Which part of the garden a plant stands in. */
    sectionOf(project: ProjectData): 'left' | 'own' | 'right' {
        if (!this.isFriendPlant(project)) return 'own';
        const own = this.gardenData.findIndex(p => !this.isFriendPlant(p));
        const index = this.gardenData.indexOf(project);
        return own === -1 || index < own ? 'left' : 'right';
    }

    setFriendPlants(ids: Iterable<string>) {
        const next = new Set(ids);
        if (next.size === this.friendPlants.size && [...next].every(id => this.friendPlants.has(id))) return;
        this.friendPlants = next;
        writeJson(FRIEND_PLANTS_KEY, [...next]);
        this.arrange();
        this.view?.scheduleRender();
    }

    /** Own plants in the middle in their order; friends' plants alternate left and right of them. */
    private arrange() {
        const own = this.gardenData.filter(p => !this.isFriendPlant(p));
        const friends = this.gardenData.filter(p => this.isFriendPlant(p));
        if (friends.length === 0) return;
        const left = friends.filter((_, i) => i % 2 === 0).reverse();
        const right = friends.filter((_, i) => i % 2 === 1);
        this.gardenData = [...left, ...own, ...right];
    }

    async mount(host: HTMLElement) {
        this.applyGarden((await this.store.load()) ?? emptyGarden());

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
            if (!(e instanceof GardenGoneError)) this.retryWhenOnline(next, options);
            throw e;
        }

        this.store = next;
        this.mirror = options.mirror ?? null;
        this.synced = remote ? snapshot(remote) : null;

        if (options.reconcile === false) {
            this.applyGarden(remote ?? emptyGarden());
            this.onSyncState?.(this.mirror ? 'synced' : 'local');
        } else {
            const mine = this.mirror ? await this.mirror.load().catch(() => null) : null;
            let chosen: Garden;
            let pushToRemote = false;

            if (remote && mine && mine.updatedAt > remote.updatedAt) {
                // This device edited the garden offline. Combine it with what others
                // saved meanwhile, when the store can; otherwise it is the newest copy.
                chosen = next.mergeOffline ? await next.mergeOffline(mine) : mine;
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
                chosen = mine ?? emptyGarden();
            }

            this.applyGarden(chosen);
            if (pushToRemote) {
                await this.saveGardenData();
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
        this._unsubscribe = this.store.subscribe?.((incoming) => {
            // With nothing unsaved here this is just `incoming`; otherwise both sides' work is kept.
            const garden = this.synced ? mergeGardens(this.synced, this.toGarden(), incoming) : incoming;
            this.synced = snapshot(incoming);
            this.applyGarden(garden);
            if (this.mirror) void this.mirror.save(garden).catch(() => {});
            this.view?.scheduleRender();
        }) ?? null;
    }

    private applyGarden(garden: Garden) {
        this.gardenData = garden.projects.filter(p => p && p.stem && p.flowers && p.roots && p.minerals);
        // SORT BY ORDER: Ensure columns appear in the arrangement the user chose!
        this.gardenData.sort((a, b) => (a.order || 0) - (b.order || 0));
        this.arrange();
        this.settings = settingsFrom(garden.settings);
        this.updatedAt = garden.updatedAt;
        this.onGardenApplied?.();
        for (const watch of this.settingsWatchers) watch();
    }

    /**
     * Replace one plant's own fields from elsewhere (a shared plant changed by
     * someone else), keeping where it stands in this garden. The caller saves.
     */
    async patchProject(id: string, data: Omit<ProjectData, 'order' | 'sharedPlantId'>): Promise<void> {
        const index = this.gardenData.findIndex(p => p.id === id);
        if (index === -1) return;
        const current = this.gardenData[index];
        this.gardenData[index] = { ...data, id: current.id, order: current.order, sharedPlantId: current.sharedPlantId };
        this.view?.scheduleRender();
    }

    /** Add a plant at the right end of the row and save. */
    async addProject(project: ProjectData): Promise<void> {
        this.gardenData.push({ ...project, order: this.gardenData.length });
        this.arrange();
        this.view?.scheduleRender();
        await this.saveGardenData();
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

    /** Persist projects + settings. Serialised so saves never interleave. */
    saveGardenData(): Promise<void> {
        this.updatedAt = new Date().toISOString();
        const run = async () => {
            // Read the garden when this save runs, not when it was queued: a merge that
            // landed in between is then part of what gets written.
            const garden = snapshot(this.toGarden());
            const store = this.store;
            if (this.mirror) await this.mirror.save(garden).catch(() => {});
            this.onSyncState?.(this.mirror ? 'syncing' : 'local');
            try {
                const written = await store.save(garden);
                if (store !== this.store) return; // switched gardens while saving
                if (written) {
                    // The store merged in someone else's work. Keep anything edited here since.
                    const current = mergeGardens(garden, this.toGarden(), written);
                    this.synced = snapshot(written);
                    this.applyGarden(current);
                    if (this.mirror) await this.mirror.save(current).catch(() => {});
                    this.view?.scheduleRender();
                } else {
                    this.synced = garden;
                }
                this.onSyncState?.(this.mirror ? 'synced' : 'local');
                this.onPersisted?.();
            } catch (e) {
                if (e instanceof GardenGoneError) {
                    this.onSyncState?.('error');
                    this.onGone?.();
                    return;
                }
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
