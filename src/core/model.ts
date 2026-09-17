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

/**
 * Carried through every save, sync and export, but nothing reads the four
 * switches yet: the ant, the worm and the fireflies are always on. They stay
 * because gardens in the wild hold them, and because a setting anyone's client
 * does not know still has to survive a merge.
 */
export interface GardenSettings {
    enableAnt: boolean;
    enableWorm: boolean;
    enableFireflies: boolean;
    fireflyCount: number;
    viewState?: ViewState;
}

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
};

export function emptyGarden(): Garden {
    return {
        version: 1,
        projects: [],
        settings: { ...DEFAULT_SETTINGS },
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
