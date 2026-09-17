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
 * through the markdown export unchanged. User uploads come later (M3).
 */

const PACK_PREFIX = '../assets/pack/';

const packFiles = import.meta.glob('../assets/pack/**/*.{png,gif,webp,jpg,jpeg,svg}', {
    eager: true,
    import: 'default',
    query: '?url',
}) as Record<string, string>;

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
if (PLANT_TYPES.length === 0) PLANT_TYPES.push('plant_1');

export class AssetManager {
    private getPathsInFolder(folderPath: string): string[] {
        const cleanPath = folderPath.replace(/\/$/, "");
        return FOLDERS.get(cleanPath) ?? [];
    }

    assignRandomImage(category: string, plantType?: string): string | null {
        let paths: string[] = [];

        // 1. If plantType is provided, try the plant-specific folder first
        if (plantType) {
            paths = this.getPathsInFolder(`${plantType}/${category}/`);
        }

        // 2. Fallback to the shared category folder (used for roots, minerals, seeds, or if plant folder is empty)
        if (paths.length === 0) {
            paths = this.getPathsInFolder(`${category}/`);
        }

        if (paths.length === 0) return null;
        return paths[Math.floor(Math.random() * paths.length)];
    }

    async getImageUrl(path: string): Promise<string | null> {
        return this.getImageUrlSync(path);
    }

    getImageUrlSync(path: string): string | null {
        return PACK.get(path) ?? null;
    }

    /**
     * A stable image from a shared category folder for an item that has none,
     * chosen by hashing its id, so it looks the same on every render and device.
     */
    fallbackImageUrl(category: string, key: string): string | null {
        const paths = [...this.getPathsInFolder(`${category}/`)].sort();
        if (paths.length === 0) return null;
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
        return PACK.get(paths[Math.abs(hash) % paths.length]) ?? null;
    }
}
