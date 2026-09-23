/**
 * The Asset Manager.
 *
 * In Obsidian this scanned the user's `Garden-Assets/` vault folder. On the web
 * the same folder layout is bundled by Vite from `src/assets/pack/`:
 *
 *   pack/<plantType>/<category>/*.png   plant-specific stems / flowers
 *   pack/<category>/*.png               shared roots / minerals / seeds
 *
 * `imagePath` on an item is the path relative to `pack/`, so it round-trips
 * through the markdown export unchanged.
 */

import { legacyImagePath } from './asset-paths';

const PACK_PREFIX = '../assets/pack/';

const packFiles = import.meta.glob<string>('../assets/pack/**/*.{png,gif,webp,jpg,jpeg,svg}', {
    eager: true,
    import: 'default',
    query: '?url',
});

/** path relative to pack/ → resolved URL (data URL after build) */
const PACK: Map<string, string> = new Map(
    Object.entries(packFiles).map(([file, url]) => [file.slice(PACK_PREFIX.length), url])
);

/** folder → files in that folder (non-recursive), e.g. "plant_1/stem" → [...] */
const FOLDERS: Map<string, string[]> = new Map();
for (const path of PACK.keys()) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const list = FOLDERS.get(dir) ?? [];
    list.push(path);
    FOLDERS.set(dir, list);
}

// --- PLANT TYPES REGISTRY ---
// Every top-level folder in the pack that has a stem/ or flowers/ subfolder.
export const PLANT_TYPES: string[] = Array.from(
    new Set(
        Array.from(FOLDERS.keys())
            .map(dir => dir.split('/'))
            .filter(parts => parts.length === 2 && (parts[1] === 'stem' || parts[1] === 'flowers'))
            .map(parts => parts[0])
    )
).sort();

/** What each plant type is called, from the Figma file. plant_9 has no name there; its leaves are plumes. */
export const PLANT_TYPE_NAMES: Readonly<Record<string, string>> = {
    plant_1: 'Bell',
    plant_2: 'Branch',
    plant_3: 'Vine',
    plant_4: 'Spray',
    plant_5: 'Arch',
    plant_6: 'Fork',
    plant_7: 'Starburst',
    plant_8: 'Cluster',
    plant_9: 'Plume',
};

/** A plant type's name. A folder new to the pack goes by its own, "plant_10" as "Plant 10". */
export function plantTypeName(plantType: string): string {
    return PLANT_TYPE_NAMES[plantType] ?? plantType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** One seed a plant can be given: the sprite the garden draws and the icon a menu shows for it. */
export interface SeedChoice {
    /** What `seedImagePath` holds, e.g. "seeds/seed7.png". */
    path: string;
    /** "Seed 7", for whoever cannot see the icon. */
    name: string;
    iconUrl: string;
}

export class AssetManager {
    /** The plant's own folder first, else the shared one (roots, minerals, seeds). No folder is ever empty. */
    assignRandomImage(category: string, plantType?: string): string | null {
        const paths = (plantType && FOLDERS.get(`${plantType}/${category}`)) || FOLDERS.get(category) || [];
        return paths.length ? paths[Math.floor(Math.random() * paths.length)] : null;
    }

    getImageUrlSync(path: string): string | null {
        const url = PACK.get(path);
        if (url) return url;
        const legacy = legacyImagePath(path);
        return (legacy && PACK.get(legacy)) ?? null;
    }

    /** Stable numeric ordering inside one art folder. */
    private sortedFolder(folder: string): string[] {
        return [...(FOLDERS.get(folder) ?? [])]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    /**
     * The exact sprite path used when a plant is switched to a type.
     * Keeping this deterministic makes the plant menu truthful: the stem it
     * shows for a type is the first stem the plant gets.
     */
    getPlantTypeImagePath(category: 'stem' | 'flowers', plantType: string, index: number): string | null {
        const paths = this.sortedFolder(`${plantType}/${category}`);
        return paths.length ? paths[Math.abs(index) % paths.length] : null;
    }

    /**
     * The seeds in the pack, in number order. Each icon in seeds/seed_icons/
     * stands for the seed sprite of the same name one folder up; an icon
     * without its sprite is left out.
     */
    getSeedChoices(): SeedChoice[] {
        return this.sortedFolder('seeds/seed_icons').flatMap(icon => {
            const file = icon.slice(icon.lastIndexOf('/') + 1);
            const path = `seeds/${file}`;
            const name = file.replace(/\.\w+$/, '').replace(/(\D)(\d)/, '$1 $2').replace(/^\w/, c => c.toUpperCase());
            const iconUrl = PACK.get(icon);
            return PACK.has(path) && iconUrl ? [{ path, name, iconUrl }] : [];
        });
    }
}
