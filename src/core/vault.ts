/**
 * A garden as a folder of files, and back (M3).
 *
 * The layout is a vault fragment, so unzipping an export into an Obsidian vault
 * root gives Max's plugin exactly what it expects:
 *
 *   Garden-Cells/<Plant>.md          one file per plant, his format
 *   garden-cells.json                sky, ant, worm, fireflies (ours; ignored by the plugin)
 *
 * Custom art under Garden-Assets/custom/ is only recognised on import.
 *
 * Import is deliberately forgiving: any `.md` anywhere in the dropped files is
 * offered to the parser and skipped unless its frontmatter says `garden-cell`,
 * so a whole vault, a single note or a folder picked in a file dialog all work.
 *
 * Nothing here touches the DOM, so it runs in a browser, in Obsidian and under
 * `node --test` alike.
 */
import { markdownToProject, projectFileName, projectToMarkdown, ASSET_FOLDER, PLANT_FOLDER } from './markdown';
import type { Garden, GardenSettings, ProjectData } from './model';
import { DEFAULT_SETTINGS, emptyGarden } from './model';

/** The file that carries the settings a plant file has no room for. */
export const SETTINGS_FILE = 'garden-cells.json';
/** Where user-supplied art lives, relative to the asset folder. */
export const CUSTOM_PREFIX = 'custom/';

export interface VaultFile {
    /** Path inside the archive, `/`-separated. */
    path: string;
    bytes: Uint8Array;
}

/** Pack-relative asset path (`custom/<hash>.png`) → the bytes behind it. */
export type AssetBytes = Map<string, Uint8Array>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- Export ---------------------------------------------------------------

/** The garden as the files that make up its folder. `exportedAt` is stamped into garden-cells.json. */
export function gardenToVaultFiles(garden: Garden, exportedAt = new Date()): VaultFile[] {
    const files: VaultFile[] = [];
    const used = new Set<string>();

    for (const project of [...garden.projects].sort((a, b) => (a.order || 0) - (b.order || 0))) {
        files.push({
            path: `${PLANT_FOLDER}/${uniqueFileName(project, used)}`,
            bytes: encoder.encode(projectToMarkdown(project)),
        });
    }

    files.push({
        path: SETTINGS_FILE,
        bytes: encoder.encode(JSON.stringify({
            version: 1,
            exportedAt: exportedAt.toISOString(),
            settings: withoutViewState(garden.settings),
        }, null, 2) + '\n'),
    });

    return files;
}

/** The camera is per device and never travels with a garden. */
function withoutViewState(settings: GardenSettings): GardenSettings {
    const { viewState: _viewState, ...rest } = settings;
    return rest;
}

/**
 * Max's file name for a plant, made unique. Two plants easily reduce to the
 * same name, or to none at all, and a vault cannot hold both.
 */
function uniqueFileName(project: ProjectData, used: Set<string>): string {
    const base = projectFileName(project).replace(/\.md$/i, '');
    let name = `${base}.md`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}.md`;
    used.add(name.toLowerCase());
    return name;
}

/** A file name for the downloaded archive, e.g. `cells.garden-2026-09-17.zip`. */
export function archiveFileName(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `cells.garden-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

// --- Import ---------------------------------------------------------------

export interface ImportResult {
    projects: ProjectData[];
    /** Present only when the archive carried a settings file. */
    settings: GardenSettings | null;
    assets: AssetBytes;
    /** Files that were looked at and left alone, for the "what happened" line. */
    skipped: string[];
}

/**
 * Read whatever the user handed over. Nesting does not matter: a vault, the
 * `Garden-Cells` folder alone, a single note, or our own archive all land here.
 */
export function vaultFilesToGarden(files: VaultFile[]): ImportResult {
    const projects: ProjectData[] = [];
    const assets: AssetBytes = new Map();
    const skipped: string[] = [];
    let settings: GardenSettings | null = null;

    for (const file of files) {
        const path = file.path.replace(/\\/g, '/');
        const base = path.slice(path.lastIndexOf('/') + 1);
        if (base.startsWith('.')) continue; // .DS_Store, .obsidian/...

        if (base === SETTINGS_FILE) {
            settings = parseSettingsFile(decoder.decode(file.bytes)) ?? settings;
            continue;
        }

        const custom = customAssetPath(path);
        if (custom) {
            assets.set(custom, file.bytes);
            continue;
        }

        if (!/\.md$/i.test(base)) {
            skipped.push(path);
            continue;
        }

        const project = markdownToProject(decoder.decode(file.bytes), base.replace(/\.md$/i, ''));
        if (project) projects.push(project);
        else skipped.push(path);
    }

    // Keep the arrangement the files asked for, and give ties a stable order.
    projects.sort((a, b) => (a.order || 0) - (b.order || 0));
    return { projects, settings, assets, skipped };
}

/** `…/Garden-Assets/custom/<hash>.png` → `custom/<hash>.png`, else null. */
function customAssetPath(path: string): string | null {
    const marker = `${ASSET_FOLDER}/${CUSTOM_PREFIX}`;
    const at = path.indexOf(marker);
    if (at === -1) return null;
    const rest = path.slice(at + marker.length);
    return rest && !rest.includes('/') ? CUSTOM_PREFIX + rest : null;
}

function parseSettingsFile(text: string): GardenSettings | null {
    try {
        const parsed = JSON.parse(text) as { settings?: Partial<GardenSettings> };
        if (!parsed || typeof parsed !== 'object' || !parsed.settings) return null;
        const { viewState: _viewState, ...rest } = parsed.settings;
        return { ...DEFAULT_SETTINGS, ...rest };
    } catch {
        return null;
    }
}

// --- Merging --------------------------------------------------------------

export type ImportMode = 'merge' | 'replace';

export interface MergeSummary {
    added: number;
    updated: number;
}

/**
 * Fold an import into the garden that is already open.
 *
 * `merge` matches on plant id: a plant that came from this garden in the first
 * place is updated in place, anything new is planted after the last column.
 * `replace` throws the current garden away, which is what "restore a backup"
 * means.
 */
export function mergeGarden(
    current: Garden,
    result: ImportResult,
    mode: ImportMode,
): { garden: Garden; summary: MergeSummary } {
    if (mode === 'replace') {
        const projects = renumber(result.projects);
        return {
            garden: {
                ...emptyGarden(),
                projects,
                settings: result.settings ?? current.settings,
                updatedAt: current.updatedAt,
            },
            summary: { added: projects.length, updated: 0 },
        };
    }

    const byId = new Map(current.projects.map(p => [p.id, p]));
    let added = 0;
    let updated = 0;
    const merged = [...current.projects];
    // A plant from somewhere else carries an `order` that means nothing here, so
    // new ones are planted after the last column rather than in among the others.
    // `result.projects` is already sorted, so they keep their arrangement.
    let lastColumn = merged.reduce((max, p) => Math.max(max, p.order || 0), -1);

    for (const incoming of result.projects) {
        const existing = byId.get(incoming.id);
        if (existing) {
            // Keep the column where it is; the file decides everything else.
            merged[merged.indexOf(existing)] = { ...incoming, order: existing.order };
            updated++;
        } else {
            merged.push({ ...incoming, order: ++lastColumn });
            added++;
        }
    }

    return {
        garden: { ...current, projects: renumber(merged), settings: current.settings },
        summary: { added, updated },
    };
}

/** Left-to-right order as a dense 0..n-1 run, so no two columns tie. */
function renumber(projects: ProjectData[]): ProjectData[] {
    return [...projects]
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((p, i) => (p.order === i ? p : { ...p, order: i }));
}
