import './shim';
import { AssetManager } from './assets';
import { GardenView } from './garden';
import type { Garden, GardenSettings, ProjectData } from './model';
import { DEFAULT_SETTINGS, emptyGarden } from './model';
import type { GardenStore } from './store';

/**
 * The app shell — what `GardenPlugin` was in Obsidian. Owns the data, the
 * settings, the asset manager and the store; mounts the GardenView.
 */
export class GardenApp {
    gardenData: ProjectData[] = [];
    settings: GardenSettings = { ...DEFAULT_SETTINGS };
    assetManager = new AssetManager();
    view: GardenView | null = null;

    private _unsubscribe: (() => void) | null = null;
    private _persistQueue: Promise<void> = Promise.resolve();

    constructor(readonly store: GardenStore) {}

    async mount(host: HTMLElement) {
        await this.loadGardenData();

        this.view = new GardenView(host, this);
        await this.view.onOpen();

        // Another tab / device changed the garden: reload and re-render.
        // (Was the vault `modify` listener in Obsidian.)
        this._unsubscribe = this.store.subscribe?.((garden) => {
            this.applyGarden(garden);
            this.view?.scheduleRender();
        }) ?? null;

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

    private applyGarden(garden: Garden) {
        this.gardenData = garden.projects.filter(p => p && p.stem && p.flowers && p.roots && p.minerals);
        // SORT BY ORDER: Ensure columns appear in the arrangement the user chose!
        this.gardenData.sort((a, b) => (a.order || 0) - (b.order || 0));
        this.settings = { ...DEFAULT_SETTINGS, ...garden.settings };
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
            updatedAt: new Date().toISOString(),
        };
    }

    private persist(): Promise<void> {
        const run = () => this.store.save(this.toGarden()).catch(e => {
            console.error('Garden Cells: save failed', e);
        });
        this._persistQueue = this._persistQueue.then(run, run);
        return this._persistQueue;
    }

    private flush = () => {
        // Make sure a pending camera/scroll save lands before the tab goes away.
        this.view?.saveViewStateNow();
    };
}
