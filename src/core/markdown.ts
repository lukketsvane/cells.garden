/**
 * Max's markdown format: one file per plant, YAML frontmatter plus
 * `## Flowers / Stem / Roots / Minerals` sections. This is exactly what the
 * Obsidian plugin writes into its `Garden-Cells/` folder, so a garden exported
 * from the web opens in the vault, and a vault folder imports back (M3).
 *
 * The bytes match the plugin's output for every ordinary plant. Three things
 * are handled here that the plugin gets away with because it never meets them:
 *
 *  - **Quoting.** The plugin escapes `"` and nothing else, so a seed holding a
 *    backslash writes YAML that no parser will accept. `yamlString` emits a
 *    correct double-quoted scalar, the same bytes whenever the plugin was
 *    already right.
 *  - **Asset paths.** In the vault an `imagePath` is a full path
 *    (`Garden-Assets/plant_1/stem/plant_1_part3.png`); in the app it is
 *    relative to the bundled pack (`plant_1/stem/plant_1_part3.png`). Export
 *    adds the prefix, import strips it, so the two sides read each other.
 *  - **Line breaks in a cell.** One list item is one line. Anything multi-line
 *    is flattened to spaces, as the plugin already does for the seed.
 */
import { load as parseYaml } from 'js-yaml';
import type { LayerItem, ProjectData } from './model';
import { simpleHash } from './model';

/** The vault folder Max's plugin scans for art. */
export const ASSET_FOLDER = 'Garden-Assets';
/** The vault folder Max's plugin keeps plant files in (his default setting). */
export const PLANT_FOLDER = 'Garden-Cells';

/** `plant_1/stem/part3.png` → `Garden-Assets/plant_1/stem/part3.png`. */
export function toVaultAssetPath(path: string): string {
    return path.startsWith(ASSET_FOLDER + '/') ? path : ASSET_FOLDER + '/' + path;
}

/** `Garden-Assets/plant_1/stem/part3.png` → `plant_1/stem/part3.png`. */
export function fromVaultAssetPath(path: string): string {
    const clean = path.replace(/\\/g, '/').replace(/^\.?\//, '');
    return clean.startsWith(ASSET_FOLDER + '/') ? clean.slice(ASSET_FOLDER.length + 1) : clean;
}

/** One line: no line breaks, no trailing space. */
function oneLine(value: string): string {
    return value.replace(/[\r\n]+/g, ' ');
}

/**
 * A value as a double-quoted YAML scalar, quotes included. Characters YAML
 * would misread are escaped; everything else is left alone, so the common case
 * is byte-for-byte what the plugin writes.
 */
function yamlString(value: string): string {
    const body = oneLine(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\t/g, '\\t')
        // The remaining control characters have no literal form inside a quoted scalar.
        .replace(/\p{Cc}/gu, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
    return '"' + body + '"';
}

// --- Export ---

function stringifyProjectFrontmatter(p: ProjectData): string {
    let yaml = `id: ${p.id}\ntype: garden-cell\nseed: ${yamlString(p.seed)}\nhue: ${p.hue}\norder: ${p.order ?? 0}\nplantType: ${p.plantType || 'plant_1'}\n`;
    if (p.seedImagePath) {
        yaml += `seedImagePath: ${yamlString(toVaultAssetPath(p.seedImagePath))}\n`;
    }
    if (p.standby) {
        yaml += `standby: true\n`;
    }

    // Image paths as ordered arrays; the index matches the body list order.
    const imgArr = (arr: LayerItem[]) =>
        arr.map(item => item.imagePath ? yamlString(toVaultAssetPath(item.imagePath)) : '""').join(', ');
    yaml += `images:\n`;
    yaml += `  flowers: [${imgArr(p.flowers)}]\n`;
    yaml += `  stem: [${imgArr(p.stem)}]\n`;
    yaml += `  roots: [${imgArr(p.roots)}]\n`;
    yaml += `  minerals: [${imgArr(p.minerals)}]\n`;

    return yaml;
}

function stringifyProjectBody(p: ProjectData): string {
    const lines: string[] = [];

    const section = (heading: string, items: LayerItem[]) => {
        if (items.length === 0) return;
        lines.push(`## ${heading}`);
        for (const item of items) {
            const content = oneLine(item.content);
            lines.push(`- ${item.highlighted ? '**' + content + '**' : content}`);
        }
        lines.push('');
    };

    section('Flowers', p.flowers);
    section('Stem', p.stem);
    section('Roots', p.roots);
    section('Minerals', p.minerals);

    return lines.join('\n').trim();
}

/** The full `.md` file content for one plant. */
export function projectToMarkdown(project: ProjectData): string {
    const frontmatter = stringifyProjectFrontmatter(project);
    const body = stringifyProjectBody(project);
    return `---\n${frontmatter}---\n${body ? '\n' + body : ''}`;
}

/** File name Max used inside the vault folder. */
export function projectFileName(project: ProjectData): string {
    const safeName = project.seed.replace(/[^a-z0-9 _-]/gi, '').trim() || "Untitled Plant";
    return `${safeName}.md`;
}

// --- Import ---

interface Frontmatter {
    id?: string;
    type?: string;
    seed?: string;
    seedImagePath?: string;
    standby?: boolean;
    hue?: number;
    order?: number;
    plantType?: string;
    images?: Record<string, string[]>;
    // Old format: items in frontmatter YAML arrays
    flowers?: unknown[];
    stem?: unknown[];
    roots?: unknown[];
    minerals?: unknown[];
}

/** Unique enough that two id-less files imported in the same millisecond differ. */
let importCounter = 0;
function fallbackProjectId(basename: string): string {
    return `unknown_${simpleHash(basename)}_${Date.now()}_${importCounter++}`;
}

/**
 * Parse one plant file. Returns null when the file is not a garden cell.
 * `basename` is the file name without `.md`, used as the fallback seed.
 */
export function markdownToProject(contents: string, basename: string): ProjectData | null {
    const fmMatch = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return null;

    let fm: Frontmatter;
    try {
        fm = (parseYaml(fmMatch[1]) ?? {}) as Frontmatter;
    } catch (e) {
        console.error("Garden Cells: frontmatter parse failed", basename, e);
        return null;
    }
    if (!fm || fm.type !== 'garden-cell') return null;

    const projectId = fm.id || fallbackProjectId(basename);

    // Detect new format: has 'images' key in frontmatter (even if empty)
    const isNewFormat = fm.images !== undefined;

    let flowers: LayerItem[] = [];
    let stem: LayerItem[] = [];
    let roots: LayerItem[] = [];
    let minerals: LayerItem[] = [];

    if (isNewFormat) {
        const bodyMatch = contents.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1] : '';
        const images = (fm.images || {}) as Record<string, string[]>;

        // Parse body by splitting on ## headings (no regex $+m bug)
        const sections: Record<string, string> = {};
        let currentSection = '';
        let currentLines: string[] = [];
        for (const line of body.split('\n')) {
            const headingMatch = line.match(/^## (.+)/);
            if (headingMatch) {
                if (currentSection) sections[currentSection] = currentLines.join('\n');
                currentSection = headingMatch[1].trim();
                currentLines = [];
            } else {
                currentLines.push(line);
            }
        }
        if (currentSection) sections[currentSection] = currentLines.join('\n');

        const parseListItems = (sectionName: string, category: string): LayerItem[] => {
            const sectionBody = sections[sectionName] || '';
            const imgPaths = Array.isArray(images[category]) ? images[category] : [];
            return sectionBody.split('\n')
                .map(line => line.trim())
                // "- x" and a bare "-" (an emptied cell); "---" and "-- x" are not list items.
                .filter(line => /^-(?: |$)/.test(line))
                .map((line, idx) => {
                    // Strip checkbox syntax if present (backward compat), then strip bullet
                    const stripped = line.replace(/^- \[[ x]\] /, '').replace(/^-(?: |$)/, '');
                    // Check for **highlighted** syntax
                    const isHighlighted = /^\*\*(.+)\*\*$/.test(stripped);
                    const content = isHighlighted ? stripped.replace(/^\*\*(.+)\*\*$/, '$1') : stripped;
                    const raw = imgPaths[idx];
                    const imgPath: string | undefined = raw ? fromVaultAssetPath(String(raw)) : undefined;

                    return {
                        id: 'item_' + simpleHash(content) + '_' + idx,
                        content: content,
                        isComplete: false,
                        highlighted: isHighlighted || undefined,
                        imagePath: imgPath
                    };
                });
        };

        flowers = parseListItems('Flowers', 'flowers');
        stem = parseListItems('Stem', 'stem');
        roots = parseListItems('Roots', 'roots');
        minerals = parseListItems('Minerals', 'minerals');
    } else {
        // Old format: items in frontmatter YAML arrays
        const parseArr = (arr: unknown[] | undefined): LayerItem[] => {
            if (!arr) return [];
            return arr.map((raw) => {
                const i = (raw ?? {}) as Partial<LayerItem>;
                return {
                    id: i.id || 'unknown',
                    content: i.content || '',
                    isComplete: i.isComplete || false,
                    imagePath: i.imagePath ? fromVaultAssetPath(i.imagePath) : undefined
                };
            });
        };
        flowers = parseArr(fm.flowers);
        stem = parseArr(fm.stem);
        roots = parseArr(fm.roots).reverse();
        minerals = parseArr(fm.minerals).reverse();
    }

    return {
        id: projectId,
        name: basename,
        seed: typeof fm.seed === 'string' && fm.seed !== '' ? fm.seed : basename,
        seedImagePath: fm.seedImagePath ? fromVaultAssetPath(fm.seedImagePath) : undefined,
        standby: fm.standby === true,
        hue: typeof fm.hue === 'number' ? fm.hue : 0,
        order: typeof fm.order === 'number' ? fm.order : 0,
        plantType: fm.plantType || 'plant_1',
        roots,
        stem,
        flowers,
        minerals
    };
}
