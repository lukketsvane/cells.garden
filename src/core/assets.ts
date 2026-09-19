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

export interface PlantPreviewPart {
    kind: 'stem' | 'flower';
    path: string;
    url: string;
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

    /**
     * Deterministic real sprites for the plant-type picker: three stems and one
     * flower from the exact same bundled pack used by the rendered garden.
     */
    getPlantPreview(plantType: string): PlantPreviewPart[] {
        const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
        const stems = [...(FOLDERS.get(`${plantType}/stem`) ?? [])].sort(numeric).slice(0, 3);
        const flowers = [...(FOLDERS.get(`${plantType}/flowers`) ?? [])].sort(numeric).slice(0, 1);
        const parts: Array<{ kind: 'stem' | 'flower'; path: string }> = [
            ...stems.map(path => ({ kind: 'stem' as const, path })),
            ...flowers.map(path => ({ kind: 'flower' as const, path })),
        ];
        return parts.flatMap(part => {
            const url = PACK.get(part.path);
            return url ? [{ ...part, url }] : [];
        });
    }
}
