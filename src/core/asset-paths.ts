export function legacyImagePath(path: string): string | null {
    const match = /^([^/]+)\/(stem|flowers)\/([^/]+)_(part|flower)(\d+)\.png$/.exec(path);
    if (!match) return null;
    const [, plantType, category, prefix, kind, index] = match;
    if (prefix !== plantType) return null;
    if ((kind === 'part') !== (category === 'stem')) return null;
    return `${plantType}/${category}/${kind === 'part' ? 'stem' : 'flower'}${index}.png`;
}
