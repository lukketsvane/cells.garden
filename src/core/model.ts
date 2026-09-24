// --- Data model ---
// Unchanged from the Obsidian plugin, minus the vault folder setting.

export interface LayerItem {
    id: string;
    content: string;
    isComplete: boolean;
    /** Key into the asset pack, e.g. "plant_1/stem/plant_1_part3.png". */
    imagePath?: string;
    highlighted?: boolean;
    /**
     * The people this cell is assigned to, by account id, in the order they
     * were added. Absent when nobody is. A plain field of the cell: it syncs,
     * merges and travels like the others, and a client that predates it keeps
     * it as it keeps any field it does not know.
     */
    assignees?: string[];
}

export interface ProjectData {
    id: string;
    name: string;
    seed: string;
    seedImagePath?: string;
    standby: boolean;
    hue: number;
    order: number;
    plantType: string;
    /** Set when this plant is shared (a `plants` row); its cells sync with everyone who has it. */
    sharedPlantId?: string;
    /**
     * Words that group this plant with others, to hide and show them together
     * (tags.ts). Absent when it has none. Like its name, they travel with the
     * plant; which tags are hidden is each device's own choice.
     */
    tags?: string[];
    roots: LayerItem[];
    stem: LayerItem[];
    flowers: LayerItem[];
    minerals: LayerItem[];
}

export type LayerName = 'stem' | 'flowers' | 'minerals' | 'roots';

export interface ViewState {
    zoom: number;
    translateX: number;
    translateY: number;
    kanbanScrollLeft: number;
    kanbanScrollTop: number;
    /** Viewport used when the camera was saved; old saves omit these. */
    viewportWidth?: number;
    viewportHeight?: number;
    /** Horizon position inside the canvas. Keeps the plants vertically stable across resizes. */
    groundRatio?: number;
}

/** A point in the sky's day: its colour ('#rrggbb') at an hour (0 to 24, minutes as a fraction). */
export interface SkyNode {
    color: string;
    hour: number;
}

/** The kinds of item this client can draw. */
export type ItemKind = 'gnome' | 'pumpkin';

/**
 * Something standing in the garden, placed from the Items menu.
 *
 * `x` is where its middle stands, in plant slots from the left edge of the
 * first plant's slot: 0.5 is the first plant, 1 the gap after it, -0.5 out in
 * the padding before it. Measured from the first plant, it does not move when
 * the padding around the plants changes; in slots, not when their spacing
 * does; and as a place in the world, not on the screen, a resize or the
 * camera never moves it. Plants added on the right leave it where it is.
 * Removing plants can leave it past the end of the world: it is then drawn at
 * the end, in the garden and never in the void, and its stored place is kept
 * for when the plants come back.
 *
 * `kind` may be one a newer client knows. Such an item is kept, not drawn.
 */
export interface GardenItem {
    id: string;
    kind: string;
    x: number;
}

/**
 * Stored with the garden, so everyone who shares it sees the same garden.
 * Every default draws the garden as it has always looked.
 *
 * The first four are carried through but never read: the ant, the worm and the
 * fireflies are always on, and `fireflyCount` was stored as 9 while the garden
 * always drew 8. They stay because gardens in the wild hold them, and a setting
 * anyone's client does not know still has to survive a merge. `fireflies` is
 * the count the garden draws.
 */
export interface GardenSettings {
    enableAnt: boolean;
    enableWorm: boolean;
    enableFireflies: boolean;
    fireflyCount: number;
    fireflies: number;
    /** 'static' holds the sky at the first node's colour. */
    skyMode: 'cycle' | 'static';
    /** Node 1 first, in the order they were added; the sky goes through them by hour. */
    skyNodes: SkyNode[];
    /** Minerals fade with depth from mineral number `mineralFadeFrom`, down to `mineralFadeMin` percent. */
    mineralFade: boolean;
    mineralFadeFrom: number;
    mineralFadeMin: number;
    /** Percent. */
    silhouetteOpacity: number;
    /** '#rrggbb' for the stem and flowers of a plant in standby; '' is the usual dark green. */
    silhouetteColor: string;
    standbyHidesMinerals: boolean;
    /**
     * Pets are switched on per garden, one `pet<Name>` flag each; a pet's key
     * is its entry in pets.ts. The gnome and the pumpkin are items now, so
     * nothing reads their flags, but gardens in the wild still carry them.
     */
    petGnome: boolean;
    petPumpkin: boolean;
    petCrow: boolean;
    /** What stands in the garden, back to front. */
    items: GardenItem[];
    viewState?: ViewState;
}

/** The sky the garden has always had (clear from 06:00, dusk at 20:00, night from 22:00 to 02:30, dawn at 04:00). */
export const DEFAULT_SKY_NODES: readonly SkyNode[] = [
    { color: '#87ceeb', hour: 6 },
    { color: '#87ceeb', hour: 18 },
    { color: '#e8bc5f', hour: 20 },
    { color: '#000000', hour: 22 },
    { color: '#000000', hour: 2.5 },
    { color: '#89e09b', hour: 4 },
];

/** The whole garden as one JSON blob. This is what a GardenStore loads and saves. */
export interface Garden {
    version: 1;
    projects: ProjectData[];
    settings: GardenSettings;
    /** ISO timestamp of the last save; last-write-wins when syncing. */
    updatedAt: string;
}

export const DEFAULT_SETTINGS: GardenSettings = {
    enableAnt: true,
    enableWorm: true,
    enableFireflies: true,
    fireflyCount: 9,
    fireflies: 8,
    skyMode: 'cycle',
    skyNodes: DEFAULT_SKY_NODES.map(n => ({ ...n })),
    mineralFade: false,
    mineralFadeFrom: 3,
    mineralFadeMin: 10,
    silhouetteOpacity: 100,
    silhouetteColor: '',
    standbyHidesMinerals: true,
    petGnome: false,
    petPumpkin: false,
    petCrow: false,
    items: [],
};

/** A fresh copy of the defaults, so no garden shares the node list or the items with another. */
export function defaultSettings(): GardenSettings {
    return { ...DEFAULT_SETTINGS, skyNodes: DEFAULT_SKY_NODES.map(n => ({ ...n })), items: [] };
}

/**
 * The stored items that can be placed: an id, a kind and a finite x. Anything
 * else is dropped, and so is a second item with an id already taken. Fields a
 * newer client added to an item stay on it.
 */
export function itemsFrom(stored: unknown): GardenItem[] {
    if (!Array.isArray(stored)) return [];
    const entries: unknown[] = stored;
    const seen = new Set<string>();
    const items: GardenItem[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const { id, kind, x } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        if (typeof kind !== 'string' || !kind) continue;
        if (typeof x !== 'number' || !Number.isFinite(x)) continue;
        seen.add(id);
        items.push({ ...entry, id, kind, x });
    }
    return items;
}

/** Stored settings over the defaults (older gardens lack the newer keys); a broken node list is the default day. */
export function settingsFrom(stored: Partial<GardenSettings> | null | undefined): GardenSettings {
    const settings = { ...defaultSettings(), ...(stored ?? {}) };
    const nodes: unknown = settings.skyNodes;
    if (!Array.isArray(nodes) || nodes.length === 0 || !nodes.every(n => n && typeof n === 'object')) {
        settings.skyNodes = defaultSettings().skyNodes;
    }
    settings.items = itemsFrom(settings.items);
    return settings;
}

export function emptyGarden(): Garden {
    return {
        version: 1,
        projects: [],
        settings: defaultSettings(),
        updatedAt: new Date(0).toISOString(),
    };
}

// --- Constants ---
export const PIXEL_SCALE = 4;
export const PLANT_SPACING = 300;
export const CLOUD_SCROLL_DURATION = 500; // seconds for one full loop
export const STEM_ORIGIN_WIDTH = 35;
export const STEM_ORIGIN_HEIGHT = 7;
export const STEM_OVERLAP_ORIGIN = 1;
export const FIXED_STACK_STEP = (STEM_ORIGIN_HEIGHT - STEM_OVERLAP_ORIGIN) * PIXEL_SCALE; // 6 * 4 = 24px

// --- Utility ---
export function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}
