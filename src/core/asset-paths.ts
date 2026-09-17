/**
 * Paths into the asset pack, and the one rule that keeps old ones working.
 *
 * Kept apart from assets.ts so it stays plain TypeScript: assets.ts reads the
 * pack through Vite's `import.meta.glob`, which only exists inside a build.
 */

/**
 * The pack mirrors the vault, where a sprite is `stem3.png` inside
 * `plant_1/stem/`. The first web build carried the eight stems and four flowers
 * bundled with the plugin instead, named `plant_1_part3.png` and
 * `plant_1_flower2.png`. Gardens saved back then still hold those paths, and a
 * markdown export from that time still writes them, so a lookup that misses
 * falls back to the same ordinal under the vault's naming.
 *
 * Returns null for a path that is not one of those old names.
 */
export function legacyImagePath(path: string): string | null {
    const match = /^([^/]+)\/(stem|flowers)\/([^/]+)_(part|flower)(\d+)\.png$/.exec(path);
    if (!match) return null;
    const [, plantType, category, prefix, kind, index] = match;
    // Only the plant's own folder ever used this naming, e.g. plant_1/stem/plant_1_part3.png.
    if (prefix !== plantType) return null;
    if ((kind === 'part') !== (category === 'stem')) return null;
    return `${plantType}/${category}/${kind === 'part' ? 'stem' : 'flower'}${index}.png`;
}
