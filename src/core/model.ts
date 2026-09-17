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
    roots: LayerItem[];
    stem: LayerItem[];
    flowers: LayerItem[];
    minerals: LayerItem[];
}

export type LayerName = 'stem' | 'flowers' | 'minerals' | 'roots';

export interface SkyKeyframe {
    time: number; // 0 to 24
    color: string; // hex code
}

export interface ViewState {
    zoom: number;
    translateX: number;
    translateY: number;
    kanbanScrollLeft: number;
    kanbanScrollTop: number;
    /** Share of the height the garden canvas takes above the kanban board, 0..1. */
    splitRatio?: number;
    /** World x where the first plant's slot started when this camera was saved (320 before it was recorded). */
    plantsLeft?: number;
}

export interface GardenSettings {
    enableAnt: boolean;
    enableWorm: boolean;
    enableFireflies: boolean;
    fireflyCount: number;
    skyKeyframes: SkyKeyframe[];
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

// --- THESE COLORS AREN'T IN USE. They're based on code I didn't implement for using hex and converting to something the math can use ---
export const DEFAULT_SETTINGS: GardenSettings = {
    enableAnt: true,
    enableWorm: true,
    enableFireflies: true,
    fireflyCount: 9,
    skyKeyframes: [
        { time: 0, color: "#130c0c" },    // Night
        { time: 6, color: "#960b9b" },    // Dawn
        { time: 12, color: "#87CEEB" },   // Day
        { time: 18, color: "#971ff3" }    // Dusk
    ]
};

export function emptyGarden(): Garden {
    return {
        version: 1,
        projects: [],
        settings: { ...DEFAULT_SETTINGS, skyKeyframes: DEFAULT_SETTINGS.skyKeyframes.map(k => ({ ...k })) },
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
