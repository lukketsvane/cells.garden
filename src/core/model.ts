// --- Data model ---
// Unchanged from the Obsidian plugin, minus the vault folder setting.

export interface LayerItem {
    id: string;
    content: string;
    isComplete: boolean;
    /** Key into the asset pack, e.g. "plant_1/stem/plant_1_part3.png". */
    imagePath?: string;
    highlighted?: boolean;
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
}

/** A point in the sky's day: its colour ('#rrggbb') at an hour (0 to 24, minutes as a fraction). */
export interface SkyNode {
    color: string;
    hour: number;
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
    /** Scene pets are opt-in per garden. */
    petSwan: boolean;
    petPumpkin: boolean;
    petCrow: boolean;
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
    petSwan: false,
    petPumpkin: false,
    petCrow: false,
};

/** A fresh copy of the defaults, so no garden shares the node list with another. */
export function defaultSettings(): GardenSettings {
    return { ...DEFAULT_SETTINGS, skyNodes: DEFAULT_SKY_NODES.map(n => ({ ...n })) };
}

/** Stored settings over the defaults (older gardens lack the newer keys); a broken node list is the default day. */
export function settingsFrom(stored: Partial<GardenSettings> | null | undefined): GardenSettings {
    const settings = { ...defaultSettings(), ...(stored ?? {}) };
    const nodes: unknown = settings.skyNodes;
    if (!Array.isArray(nodes) || nodes.length === 0 || !nodes.every(n => n && typeof n === 'object')) {
        settings.skyNodes = defaultSettings().skyNodes;
    }
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
