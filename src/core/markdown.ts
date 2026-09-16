/**
 * Max's markdown format: one file per plant with YAML frontmatter and
 * `## Flowers / Stem / Roots / Minerals` sections. Kept as import/export so
 * the Obsidian vault and the web garden stay compatible (M3).
 */
import { load as parseYaml } from 'js-yaml';
import type { LayerItem, ProjectData } from './model';
import { simpleHash } from './model';

// --- Export ---

function stringifyProjectFrontmatter(p: ProjectData): string {
    const esc = (str: string) => str.replace(/"/g, '\\"').replace(/\n/g, ' ');

    let yaml = `id: ${p.id}\ntype: garden-cell\nseed: "${esc(p.seed)}"\nhue: ${p.hue}\norder: ${p.order ?? 0}\nplantType: ${p.plantType || 'plant_1'}\n`;
    if (p.seedImagePath) {
        yaml += `seedImagePath: "${esc(p.seedImagePath)}"\n`;
    }
    if (p.standby) {
        yaml += `standby: true\n`;
    }

    // Store image paths as ordered arrays (index matches body list order)
    const imgArr = (arr: LayerItem[]) =>
        arr.map(item => item.imagePath ? `"${esc(item.imagePath)}"` : '""').join(', ');
    yaml += `images:\n`;
    yaml += `  flowers: [${imgArr(p.flowers)}]\n`;
    yaml += `  stem: [${imgArr(p.stem)}]\n`;
    yaml += `  roots: [${imgArr(p.roots)}]\n`;
    yaml += `  minerals: [${imgArr(p.minerals)}]\n`;

    return yaml;
}

function stringifyProjectBody(p: ProjectData): string {
    const lines: string[] = [];

    if (p.flowers.length > 0) {
        lines.push('## Flowers');
        p.flowers.forEach(item => { lines.push(`- ${item.highlighted ? '**' + item.content + '**' : item.content}`); });
        lines.push('');
    }

    if (p.stem.length > 0) {
        lines.push('## Stem');
        p.stem.forEach(item => { lines.push(`- ${item.highlighted ? '**' + item.content + '**' : item.content}`); });
        lines.push('');
    }

    if (p.roots.length > 0) {
        lines.push('## Roots');
        p.roots.forEach(item => { lines.push(`- ${item.highlighted ? '**' + item.content + '**' : item.content}`); });
        lines.push('');
    }

    if (p.minerals.length > 0) {
        lines.push('## Minerals');
        p.minerals.forEach(item => { lines.push(`- ${item.highlighted ? '**' + item.content + '**' : item.content}`); });
        lines.push('');
    }

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

    const projectId = fm.id || 'unknown_' + Date.now();

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
            const imgPaths = images[category] || [];
            return sectionBody.split('\n')
                .map(line => line.trim())
                .filter(line => /^- /.test(line))
                .map((line, idx) => {
                    // Strip checkbox syntax if present (backward compat), then strip bullet
                    const stripped = line.replace(/^- \[[ x]\] /, '').replace(/^- /, '');
                    // Check for **highlighted** syntax
                    const isHighlighted = /^\*\*(.+)\*\*$/.test(stripped);
                    const content = isHighlighted ? stripped.replace(/^\*\*(.+)\*\*$/, '$1') : stripped;
                    const imgPath: string | undefined = imgPaths[idx] || undefined;

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
                    imagePath: i.imagePath || undefined
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
        seed: fm.seed || basename,
        seedImagePath: fm.seedImagePath || undefined,
        standby: fm.standby === true,
        hue: fm.hue || 0,
        order: fm.order || 0,
        plantType: fm.plantType || 'plant_1',
        roots,
        stem,
        flowers,
        minerals
    };
}
